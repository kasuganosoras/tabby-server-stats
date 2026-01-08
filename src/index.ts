import { NgModule, ComponentFactoryResolver, ApplicationRef, Injector, EmbeddedViewRef } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import TabbyCoreModule, { ToolbarButtonProvider, ConfigProvider, TranslateService, AppService, ConfigService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { NgChartsModule } from 'ng2-charts'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { ServerStatsConfigProvider } from './config'
import { TRANSLATIONS } from './translations'
import { StatsService } from './services/stats.service'
import { StatsToolbarButtonProvider } from './toolbar-button.provider'
import { ServerStatsFloatingPanelComponent } from './components/floating-panel.component'
import { ServerStatsBottomBarComponent } from './components/bottom-bar.component'
import { ServerStatsSettingsComponent, ServerStatsSettingsTabProvider } from './components/settings.component'

type TabInstance = {
    teardown: () => void
    timerId: any
    collector: () => Promise<any>
    state: any
    configSub: any
}

const LOG_PATH = path.join(os.tmpdir(), 'tabby-server-stats.log')
const logDebug = (message: string) => {
    try {
        fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`)
    } catch {}
}

logDebug('[init] module loaded')

@NgModule({
    imports: [CommonModule, FormsModule, NgChartsModule, TabbyCoreModule, NgbModule], 
    declarations: [ServerStatsFloatingPanelComponent, ServerStatsBottomBarComponent, ServerStatsSettingsComponent],
    entryComponents: [ServerStatsFloatingPanelComponent, ServerStatsBottomBarComponent, ServerStatsSettingsComponent],
    providers: [
        { provide: ConfigProvider, useClass: ServerStatsConfigProvider, multi: true },
        { provide: ToolbarButtonProvider, useClass: StatsToolbarButtonProvider, multi: true },
        { provide: SettingsTabProvider, useClass: ServerStatsSettingsTabProvider, multi: true }, 
        StatsService
    ]
})
export default class ServerStatsModule {
    private floatingRef: any = null
    private floatingElem: HTMLElement | null = null
    private activeDisplayMode: string | null = null
    private tabInstances: WeakMap<HTMLElement, TabInstance> = new WeakMap()
    private attachedTabs = new Set<HTMLElement>()
    private tabElementMap = new Map<HTMLElement, any>()
    private observer: MutationObserver | null = null
    private disposables: Array<() => void> = []
    private styleNode: HTMLStyleElement | null = null
    private observerRetry: any = null
    private failed = false
    private mutationScheduled = false
    private pendingAdded = new Set<HTMLElement>()
    private pendingRemoved = new Set<HTMLElement>()
    private mutationBurst = 0
    private mutationBurstTimer: any = null
    private scanTimer: any = null

    constructor(
        private app: AppService, 
        private config: ConfigService,
        private componentFactoryResolver: ComponentFactoryResolver,
        private appRef: ApplicationRef,
        private injector: Injector,
        private statsService: StatsService,
        translate: TranslateService
    ) {
        logDebug('[init] constructor start')
        this.config.ready$.subscribe(() => {
            setTimeout(() => {
                this.safeRun('translations', () => {
                    for (const [lang, trans] of Object.entries(TRANSLATIONS)) {
                        translate.setTranslation(lang, trans, true);
                    }
                })
            }, 1000);
        });

        this.config.ready$.subscribe(() => {
            setTimeout(() => {
                logDebug('[event] config.ready')
                this.safeRun('applyDisplayMode:ready', () => this.applyDisplayMode(this.getDisplayMode()))
            }, 500);
        })

        this.config.changed$.subscribe(() => {
            logDebug('[event] config.changed')
            this.safeRun('applyDisplayMode:changed', () => this.applyDisplayMode(this.getDisplayMode()))
        })
        logDebug('[init] constructor end')
    }

    private getDisplayMode() {
        return this.config.store.plugin?.serverStats?.displayMode || 'bottomBar'
    }

    private safeRun(label: string, fn: () => void) {
        if (this.failed) {
            return
        }
        try {
            fn()
        } catch (err) {
            this.failed = true
            logDebug(`[error] ${label}: ${err instanceof Error ? err.stack || err.message : String(err)}`)
        }
    }

    private applyDisplayMode(mode: string) {
        logDebug(`[state] applyDisplayMode ${mode}`)
        const previousMode = this.activeDisplayMode
        this.activeDisplayMode = mode

        if (previousMode === mode) {
            if (mode === 'bottomBar' && this.attachedTabs.size === 0) {
                this.initializePerTabBars()
            }
            return
        }

        this.destroyFloating()
        this.teardownAllTabs()

        if (mode === 'floatingPanel') {
            this.safeRun('createFloatingPanel', () => this.createFloatingPanel())
        } else {
            this.safeRun('ensureGlobalStyle', () => this.ensureGlobalStyle())
            this.safeRun('initializePerTabBars', () => this.initializePerTabBars())
        }
    }

    private createFloatingPanel() {
        logDebug('[state] createFloatingPanel')
        const floatingFactory = this.componentFactoryResolver.resolveComponentFactory(ServerStatsFloatingPanelComponent)
        this.floatingRef = floatingFactory.create(this.injector)
        this.appRef.attachView(this.floatingRef.hostView)
        this.floatingElem = (this.floatingRef.hostView as EmbeddedViewRef<any>).rootNodes[0] as HTMLElement
        document.body.appendChild(this.floatingElem);
        this.floatingRef.changeDetectorRef.detectChanges();
        setTimeout(() => this.floatingRef.instance.checkAndFetch(), 100);
    }

    private initializePerTabBars() {
        logDebug('[state] initializePerTabBars')
        this.safeRun('rebuildTabElementMap', () => this.rebuildTabElementMap())
        this.safeRun('attachExistingTabs', () => this.attachExistingTabs())
        this.safeRun('observeTabLifecycle', () => this.observeTabLifecycle())
        this.safeRun('startMutationObserver', () => this.startMutationObserver())
        this.safeRun('startScanTimer', () => this.startScanTimer())
    }

    private ensureGlobalStyle() {
        if (this.styleNode) {
            return
        }
        if (!document.head) {
            this.scheduleObserverRetry()
            return
        }
        logDebug('[state] ensureGlobalStyle')
        const style = document.createElement('style')
        style.setAttribute('data-server-stats-style', '1')
        style.textContent = `
            ssh-tab.server-stats-tab {
                display: flex;
                flex-direction: column;
            }
            ssh-tab.server-stats-tab > .server-stats-bottom-host {
                flex: 0 0 auto;
                width: 100%;
            }
            ssh-tab.server-stats-tab > *:not(.server-stats-bottom-host) {
                flex: 1 1 auto;
                min-height: 0;
            }
            .server-stats-bottom-host {
                width: 100%;
            }
        `
        document.head.appendChild(style)
        this.styleNode = style
    }

    private attachExistingTabs() {
        const content = document.querySelector('app-root > div > .content')
        if (!content) {
            logDebug('[state] attachExistingTabs: no content')
            this.scheduleObserverRetry()
            return
        }
        this.rebuildTabElementMap()
        const candidates = content.querySelectorAll('ssh-tab')
        logDebug(`[state] attachExistingTabs ${candidates.length}`)
        candidates.forEach(el => this.attachToSshTab(el as HTMLElement))
    }

    private startMutationObserver() {
        const target = this.getObserverTarget()
        if (!target) {
            logDebug('[state] startMutationObserver: no target')
            this.scheduleObserverRetry()
            return
        }
        logDebug('[state] startMutationObserver: ok')
        if (this.observer) {
            this.observer.disconnect()
        }
        this.observer = new MutationObserver(mutations => {
            this.trackMutationBurst(mutations.length)
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => this.queueMutationNode(node, true))
                mutation.removedNodes.forEach(node => this.queueMutationNode(node, false))
            })
            this.flushMutationQueue()
        })
        this.observer.observe(target, { childList: true, subtree: true })
    }

    private queueMutationNode(node: Node, added: boolean) {
        if (!(node instanceof HTMLElement)) {
            return
        }
        if (added) {
            this.pendingAdded.add(node)
        } else {
            this.pendingRemoved.add(node)
        }
    }

    private flushMutationQueue() {
        if (this.mutationScheduled) {
            return
        }
        this.mutationScheduled = true
        window.setTimeout(() => {
            this.mutationScheduled = false
            this.pendingAdded.forEach(node => this.scanNodeForTabs(node))
            this.pendingRemoved.forEach(node => this.handleRemovedNode(node))
            this.pendingAdded.clear()
            this.pendingRemoved.clear()
        }, 0)
    }

    private getObserverTarget(): HTMLElement | null {
        return (document.querySelector('app-root > div > .content') as HTMLElement) || null
    }

    private trackMutationBurst(count: number) {
        this.mutationBurst += count
        if (!this.mutationBurstTimer) {
            this.mutationBurstTimer = window.setTimeout(() => {
                this.mutationBurst = 0
                this.mutationBurstTimer = null
            }, 1000)
        }
        if (this.mutationBurst > 2000 && this.observer) {
            logDebug('[state] mutation burst detected, disabling observer')
            this.observer.disconnect()
            this.observer = null
        }
    }

    private scheduleObserverRetry() {
        if (this.observerRetry) {
            return
        }
        logDebug('[state] scheduleObserverRetry')
        this.observerRetry = window.setTimeout(() => {
            this.observerRetry = null
            if (this.activeDisplayMode === 'bottomBar') {
                logDebug('[state] observerRetry tick')
                this.safeRun('ensureGlobalStyle:retry', () => this.ensureGlobalStyle())
                this.safeRun('attachExistingTabs:retry', () => this.attachExistingTabs())
                this.safeRun('startMutationObserver:retry', () => this.startMutationObserver())
            }
        }, 250)
    }

    private scanNodeForTabs(node: Node) {
        if (!(node instanceof HTMLElement)) {
            return
        }
        if (node.tagName && node.tagName.toLowerCase() === 'ssh-tab') {
            this.attachToSshTab(node)
            return
        }
        const inner = node.querySelectorAll('ssh-tab')
        inner.forEach(el => this.attachToSshTab(el as HTMLElement))
    }

    private handleRemovedNode(node: Node) {
        if (!(node instanceof HTMLElement)) {
            return
        }
        if (node.tagName && node.tagName.toLowerCase() === 'ssh-tab') {
            if (this.tabInstances.has(node)) {
                this.detachFromTab(node)
            }
            return
        }
        const inner = node.querySelectorAll('ssh-tab')
        inner.forEach(el => this.detachFromTab(el as HTMLElement))
    }

    private startScanTimer() {
        if (this.scanTimer) {
            return
        }
        this.scanTimer = window.setInterval(() => {
            if (this.activeDisplayMode !== 'bottomBar') {
                return
            }
            this.attachExistingTabs()
        }, 1500)
    }

    private attachToSshTab(sshTabEl: HTMLElement) {
        if (this.activeDisplayMode !== 'bottomBar') {
            return
        }
        if (!sshTabEl || this.tabInstances.has(sshTabEl) || sshTabEl.getAttribute('data-ss-attached') === '1') {
            return
        }
        logDebug('[state] attachToSshTab')

        this.rebuildTabElementMap()
        sshTabEl.setAttribute('data-ss-attached', '1')
        sshTabEl.classList.add('server-stats-tab')

        const host = document.createElement('div')
        host.classList.add('server-stats-bottom-host')
        host.setAttribute('data-ss-host', '1')
        sshTabEl.appendChild(host)

        const barFactory = this.componentFactoryResolver.resolveComponentFactory(ServerStatsBottomBarComponent)
        const barRef = barFactory.create(this.injector)
        const session = this.resolveSessionForElement(sshTabEl)
        if ((barRef.instance as any).useExternalController !== undefined) {
            (barRef.instance as any).useExternalController = true
        }
        if ((barRef.instance as any).bindToSession) {
            (barRef.instance as any).bindToSession(session)
        }
        this.appRef.attachView(barRef.hostView)
        const barElem = (barRef.hostView as EmbeddedViewRef<any>).rootNodes[0] as HTMLElement
        host.appendChild(barElem)
        barRef.changeDetectorRef.detectChanges()

        const state: any = { last: null }
        let activeSession: any = session
        const collector = async () => {
            const resolvedSession = this.resolveSessionForElement(sshTabEl)
            if (resolvedSession && resolvedSession !== activeSession) {
                activeSession = resolvedSession
                if ((barRef.instance as any).bindToSession) {
                    (barRef.instance as any).bindToSession(activeSession)
                }
            }
            if (!activeSession) {
                return { data: null, session: null, supported: false }
            }
            const supported = this.statsService.isPlatformSupport(activeSession)
            if (!supported) {
                return { data: null, session: activeSession, supported: false }
            }
            const data = await this.statsService.fetchStats(activeSession)
            return { data, session: activeSession, supported: true }
        }

        const runPoll = async () => {
            const isEnabled = this.config.store.plugin?.serverStats?.enabled
            const displayMode = this.getDisplayMode()
            if (!isEnabled || displayMode !== 'bottomBar') {
                if ((barRef.instance as any).hideExternal) {
                    (barRef.instance as any).hideExternal()
                }
                return
            }
            const result = await collector()
            if (!result) {
                return
            }
            if (!result.session) {
                if ((barRef.instance as any).hideExternal) {
                    (barRef.instance as any).hideExternal()
                }
                return
            }
            if (!result.supported) {
                if ((barRef.instance as any).hideExternal) {
                    (barRef.instance as any).hideExternal()
                }
                return
            }
            if (result.data) {
                state.last = result.data
                if ((barRef.instance as any).renderExternalStats) {
                    (barRef.instance as any).renderExternalStats(result.data)
                }
            } else if ((barRef.instance as any).setExternalLoading) {
                (barRef.instance as any).setExternalLoading(false)
            }
        }

        const syncOnConfigChange = () => {
            const isEnabled = this.config.store.plugin?.serverStats?.enabled
            const displayMode = this.getDisplayMode()
            if (!isEnabled || displayMode !== 'bottomBar') {
                if ((barRef.instance as any).hideExternal) {
                    (barRef.instance as any).hideExternal()
                }
                return
            }
            if ((barRef.instance as any).setExternalLoading) {
                (barRef.instance as any).setExternalLoading(true)
            }
            runPoll()
        }

        syncOnConfigChange()
        const timerId = window.setInterval(runPoll, 3000)
        const configSub = this.config.changed$?.subscribe(() => {
            syncOnConfigChange()
        })

        const teardown = () => {
            if (timerId) {
                clearInterval(timerId)
            }
            if (configSub && typeof configSub.unsubscribe === 'function') {
                configSub.unsubscribe()
            }
            try {
                barRef.destroy()
            } catch {}
            try {
                this.appRef.detachView(barRef.hostView)
            } catch {}
            if (host.parentNode === sshTabEl) {
                host.parentNode.removeChild(host)
            }
            sshTabEl.removeAttribute('data-ss-attached')
            sshTabEl.classList.remove('server-stats-tab')
        }

        this.tabInstances.set(sshTabEl, { teardown, timerId, collector, state, configSub })
        this.attachedTabs.add(sshTabEl)
    }

    private detachFromTab(tabEl: HTMLElement) {
        const existing = this.tabInstances.get(tabEl)
        if (existing) {
            logDebug('[state] detachFromTab')
            existing.teardown()
            this.tabInstances.delete(tabEl)
        }
        this.attachedTabs.delete(tabEl)
        this.tabElementMap.delete(tabEl)
    }

    private rebuildTabElementMap() {
        this.tabElementMap.clear()
        const tabs = this.getAllLeafTabs()
        tabs.forEach(tab => {
            const el = this.getTabElement(tab)
            if (el) {
                this.tabElementMap.set(el, tab)
            }
        })
    }

    private getAllLeafTabs(): any[] {
        const result: any[] = []
        const walk = (tab: any) => {
            if (!tab) return
            if (typeof tab.getAllTabs === 'function') {
                const inner = tab.getAllTabs()
                if (Array.isArray(inner)) {
                    inner.forEach((t: any) => walk(t))
                    return
                }
            }
            result.push(tab)
        }
        if (Array.isArray(this.app.tabs)) {
            this.app.tabs.forEach(tab => walk(tab))
        }
        return result
    }

    private getTabElement(tab: any): HTMLElement | null {
        if (!tab) return null
        const direct = tab.element && tab.element.nativeElement
        if (direct instanceof HTMLElement) {
            return direct
        }
        const hostView = tab.hostView && (tab.hostView as any).rootNodes
        if (hostView && hostView[0] instanceof HTMLElement) {
            return hostView[0]
        }
        const embedded = tab.viewContainerEmbeddedRef && tab.viewContainerEmbeddedRef.rootNodes
        if (embedded && embedded[0] instanceof HTMLElement) {
            return embedded[0]
        }
        return null
    }

    private resolveSessionForElement(el: HTMLElement): any {
        const tab = this.tabElementMap.get(el)
        if (tab) {
            return this.resolveSessionFromTab(tab)
        }
        for (const [knownEl, knownTab] of this.tabElementMap.entries()) {
            if (knownEl && knownEl.contains && knownEl.contains(el)) {
                return this.resolveSessionFromTab(knownTab)
            }
        }
        return null
    }

    private resolveSessionFromTab(tab: any): any {
        if (!tab) return null
        if (tab.session) return tab.session
        if (tab.focusedTab) {
            return this.resolveSessionFromTab(tab.focusedTab)
        }
        return null
    }

    private observeTabLifecycle() {
        this.disposables.forEach(fn => fn())
        this.disposables = []

        const tabRemoved = this.app.tabRemoved$?.subscribe(tab => {
            const el = this.getTabElement(tab)
            if (el) {
                this.detachFromTab(el)
            }
            this.rebuildTabElementMap()
        })
        const tabClosed = this.app.tabClosed$?.subscribe(tab => {
            const el = this.getTabElement(tab)
            if (el) {
                this.detachFromTab(el)
            }
            this.rebuildTabElementMap()
        })
        const tabOpened = this.app.tabOpened$?.subscribe(() => {
            this.rebuildTabElementMap()
            this.attachExistingTabs()
        })
        const tabsChanged = this.app.tabsChanged$?.subscribe(() => {
            this.rebuildTabElementMap()
            this.attachExistingTabs()
        })

        ;[tabRemoved, tabClosed, tabOpened, tabsChanged].forEach(sub => {
            if (sub && typeof sub.unsubscribe === 'function') {
                this.disposables.push(() => sub.unsubscribe())
            }
        })
    }

    private destroyFloating() {
        if (this.floatingRef) {
            try {
                this.appRef.detachView(this.floatingRef.hostView)
            } catch {}
            this.floatingRef.destroy()
            if (this.floatingElem && this.floatingElem.parentNode) {
                this.floatingElem.parentNode.removeChild(this.floatingElem)
            }
            this.floatingRef = null
            this.floatingElem = null
        }
    }

    private teardownAllTabs() {
        if (this.observer) {
            this.observer.disconnect()
            this.observer = null
        }
        if (this.scanTimer) {
            clearInterval(this.scanTimer)
            this.scanTimer = null
        }
        this.disposables.forEach(fn => fn())
        this.disposables = []
        this.attachedTabs.forEach(el => {
            const instance = this.tabInstances.get(el)
            if (instance) {
                instance.teardown()
            }
        })
        this.attachedTabs.clear()
        this.tabInstances = new WeakMap()
        this.tabElementMap.clear()
    }
}
