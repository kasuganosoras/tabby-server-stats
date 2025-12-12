import { NgModule, ComponentFactoryResolver, ApplicationRef, Injector, EmbeddedViewRef } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import TabbyCoreModule, { ToolbarButtonProvider, ConfigProvider, TranslateService, AppService, ConfigService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { NgChartsModule } from 'ng2-charts'

import { ServerStatsConfigProvider } from './config'
import { TRANSLATIONS } from './translations'
import { StatsService } from './services/stats.service'
import { StatsToolbarButtonProvider } from './toolbar-button.provider'
import { ServerStatsFloatingPanelComponent } from './components/floating-panel.component'
import { ServerStatsBottomBarComponent } from './components/bottom-bar.component'
import { ServerStatsSettingsComponent, ServerStatsSettingsTabProvider } from './components/settings.component'

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
    private bottomBarRef: any = null
    private floatingElem: HTMLElement | null = null
    private bottomBarElem: HTMLElement | null = null

    constructor(
        app: AppService, 
        config: ConfigService,
        componentFactoryResolver: ComponentFactoryResolver,
        appRef: ApplicationRef,
        injector: Injector,
        translate: TranslateService
    ) {
        config.ready$.subscribe(() => {
            setTimeout(() => {
                for (const [lang, trans] of Object.entries(TRANSLATIONS)) {
                    translate.setTranslation(lang, trans, true);
                }
            }, 1000);
        });

        const createComponent = (displayMode: string) => {
            this.destroyComponents()

            if (displayMode === 'floatingPanel') {
                const floatingFactory = componentFactoryResolver.resolveComponentFactory(ServerStatsFloatingPanelComponent)
                this.floatingRef = floatingFactory.create(injector)
                appRef.attachView(this.floatingRef.hostView)
                this.floatingElem = (this.floatingRef.hostView as EmbeddedViewRef<any>).rootNodes[0] as HTMLElement
                document.body.appendChild(this.floatingElem);
                (window as any).serverStatsFloating = this.floatingRef.instance;
                this.floatingRef.changeDetectorRef.detectChanges();
                setTimeout(() => this.floatingRef.instance.checkAndFetch(), 100);
            } else {
                const bottomBarFactory = componentFactoryResolver.resolveComponentFactory(ServerStatsBottomBarComponent)
                this.bottomBarRef = bottomBarFactory.create(injector)
                appRef.attachView(this.bottomBarRef.hostView)
                this.bottomBarElem = (this.bottomBarRef.hostView as EmbeddedViewRef<any>).rootNodes[0] as HTMLElement
                const targetContainer = document.querySelector('app-root > div > .content');
                if (targetContainer) {
                    targetContainer.appendChild(this.bottomBarElem);
                } else {
                    document.body.appendChild(this.bottomBarElem);
                }
                (window as any).serverStatsBottomBar = this.bottomBarRef.instance;
                this.bottomBarRef.changeDetectorRef.detectChanges();
                setTimeout(() => this.bottomBarRef.instance.checkAndFetch(), 100);
            }
        }

        const getDisplayMode = () => {
            return config.store.plugin?.serverStats?.displayMode || 'bottomBar'
        }

        config.ready$.subscribe(() => {
            setTimeout(() => {
                createComponent(getDisplayMode())
            }, 500);
        })

        config.changed$.subscribe(() => {
            const currentMode = getDisplayMode()
            const existingMode = this.floatingRef ? 'floatingPanel' : (this.bottomBarRef ? 'bottomBar' : null)
            if (existingMode !== currentMode) {
                createComponent(currentMode)
            }
        })
    }

    private destroyComponents() {
        if (this.floatingRef) {
            this.floatingRef.destroy()
            if (this.floatingElem && this.floatingElem.parentNode) {
                this.floatingElem.parentNode.removeChild(this.floatingElem)
            }
            this.floatingRef = null
            this.floatingElem = null
            delete (window as any).serverStatsFloating
        }

        if (this.bottomBarRef) {
            this.bottomBarRef.destroy()
            if (this.bottomBarElem && this.bottomBarElem.parentNode) {
                this.bottomBarElem.parentNode.removeChild(this.bottomBarElem)
            }
            this.bottomBarRef = null
            this.bottomBarElem = null
            delete (window as any).serverStatsBottomBar
        }
    }
}