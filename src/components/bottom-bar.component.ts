import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core'
import { Subscription } from 'rxjs'
import { AppService, ConfigService } from 'tabby-core'
import { StatsService } from '../services/stats.service'
import { CustomMetric } from '../config'

@Component({
    selector: 'server-stats-bottom-bar',
    template: `
        <div class="stats-container" 
             *ngIf="visible"
             [style.background]="styleConfig.background">
            <div class="stat-section" *ngIf="loading">
                <div class="loading-text">Loading...</div>
            </div>
            
            <ng-container *ngIf="!loading">
                <div class="stat-section">
                    <div class="stat-label">{{ 'CPU' | translate }}</div>
                    <div class="stat-content">
                        <div class="progress-bar-container">
                            <div class="progress-bar" [style.width.%]="currentStats.cpu" [style.background-color]="getCpuColor()"></div>
                        </div>
                        <div class="stat-value">{{currentStats.cpu | number:'1.0-0'}}%</div>
                    </div>
                </div>
                <div class="stat-separator"></div>

                <div class="stat-section">
                    <div class="stat-label">{{ 'RAM' | translate }}</div>
                    <div class="stat-content">
                        <div class="progress-bar-container">
                            <div class="progress-bar" [style.width.%]="currentStats.mem" [style.background-color]="getMemColor()"></div>
                        </div>
                        <div class="stat-value">{{currentStats.mem | number:'1.0-0'}}%</div>
                    </div>
                </div>
                <div class="stat-separator"></div>

                <div class="stat-section">
                    <div class="stat-label">{{ 'DISK' | translate }}</div>
                    <div class="stat-content">
                        <div class="progress-bar-container">
                            <div class="progress-bar" [style.width.%]="currentStats.disk" [style.background-color]="getDiskColor()"></div>
                        </div>
                        <div class="stat-value">{{currentStats.disk | number:'1.0-0'}}%</div>
                    </div>
                </div>

                <ng-container *ngFor="let metric of customMetrics; let i = index">
                    <div class="stat-separator"></div>
                    <div class="stat-section">
                        <div class="stat-label">{{ metric.label }}</div>
                        
                        <div class="stat-content" *ngIf="metric.type === 'progress'">
                            <div class="progress-bar-container">
                                <div class="progress-bar" 
                                     [style.width.%]="getCustomProgress(i)" 
                                     [style.background-color]="metric.color || '#3498db'"></div>
                            </div>
                            <div class="stat-value">{{ getCustomValue(i) }}</div>
                        </div>

                        <div class="stat-content" *ngIf="metric.type === 'text'">
                            <div class="stat-value" [style.color]="metric.color || 'inherit'">
                                {{ getCustomValue(i) }} {{ metric.suffix }}
                            </div>
                        </div>
                    </div>
                </ng-container>

                <div class="stat-separator"></div>

                <div class="stat-section net-section">
                    <div class="stat-label">{{ 'NET' | translate }}</div>
                    <div class="net-container">
                        <div class="net-row download">
                            <span>↓</span> <span class="net-value">{{ formatSpeed(currentStats.netRx) }}</span>
                        </div>
                        <div class="net-row upload">
                            <span>↑</span> <span class="net-value">{{ formatSpeed(currentStats.netTx) }}</span>
                        </div>
                    </div>
                </div>
            </ng-container>
        </div>
    `,
    styles: [`
        :host { display: block; width: 100%; position: relative; box-sizing: border-box; }
        .stats-container {
            position: relative;
            width: 100%;
            box-sizing: border-box;
            backdrop-filter: blur(8px);
            padding: 6px 12px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px 12px;
            justify-content: flex-start;
            align-items: flex-start;
            border-top: 1px solid rgba(255,255,255,0.15);
            color: rgba(255,255,255,0.9);
            user-select: none;
            font-size: 11px;
        }
        .stat-section { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
        .stat-label { font-weight: 500; color: rgba(255,255,255,0.7); font-size: 12px; line-height: 1; min-width: 24px; white-space: nowrap; }
        .stat-content { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .progress-bar-container { height: 6px; background-color: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; width: 60px; }
        .progress-bar { height: 100%; transition: width 0.3s ease, background-color 0.3s ease; border-radius: 3px; }
        .stat-value { font-family: monospace; font-size: 12px; color: rgba(255,255,255,0.9); line-height: 1.4; white-space: nowrap; text-align: left; }
        .stat-separator { width: 1px; min-height: 16px; background-color: rgba(255,255,255,0.2); margin: 0 2px; align-self: stretch; flex: 0 0 1px; }
        .net-section { min-width: 120px; margin-left: auto; }
        .net-container { display: flex; flex-direction: column; gap: 4px; font-family: monospace; font-size: 10px; align-items: flex-start; }
        .net-row { white-space: nowrap; display: flex; align-items: center; gap: 4px; line-height: 1.2; }
        .net-value { display: inline-block; min-width: 60px; text-align: left; }
        .download { color: #2ecc71; }
        .upload { color: #e74c3c; }
        .loading-text { color: rgba(255,255,255,0.6); font-size: 10px; font-style: italic; }
    `]
})
export class ServerStatsBottomBarComponent implements OnInit, OnDestroy {
    visible = false
    loading = true
    currentStats: any = { cpu: 0, mem: 0, disk: 0, netRx: 0, netTx: 0, custom: [] }
    customMetrics: CustomMetric[] = []
    
    public styleConfig = { background: 'rgba(20, 20, 20, 0.85)' }
    private timerId: any = null
    private tabSubscription: Subscription | null = null
    private configSubscriptions: Subscription[] = []
    private boundSession: any = null
    public useExternalController = false

    constructor(
        private statsService: StatsService,
        private config: ConfigService,
        private app: AppService,
        private cdr: ChangeDetectorRef,
        private zone: NgZone
    ) {
    }

    getCpuColor(): string {
        const cpu = this.currentStats.cpu;
        if (cpu < 50) return '#2ecc71';
        if (cpu < 80) return '#f1c40f';
        return '#e74c3c';
    }

    getMemColor(): string {
        const mem = this.currentStats.mem;
        if (mem < 50) return '#2ecc71';
        if (mem < 80) return '#f1c40f';
        return '#e74c3c';
    }

    getDiskColor(): string {
        const disk = this.currentStats.disk;
        if (disk < 50) return '#2ecc71';
        if (disk < 80) return '#3498db';
        return '#e74c3c';
    }

    bindToSession(session: any) {
        this.boundSession = session;
        this.visible = true;
        this.loading = true;
    }

    renderExternalStats(stats: any | null) {
        this.visible = true;
        if (stats) {
            this.visible = true;
            this.loading = false;
            this.updateStats(stats);
            this.currentStats = stats;
        } else {
            this.loading = false;
        }
        this.cdr.detectChanges();
    }

    setExternalLoading(isLoading: boolean) {
        this.visible = true;
        this.loading = isLoading;
        this.cdr.detectChanges();
    }

    hideExternal() {
        this.visible = false;
        this.loading = true;
        this.cdr.detectChanges();
    }

    // 获取自定义指标的值
    getCustomValue(index: number): string {
        if (!this.currentStats.custom || !this.currentStats.custom[index]) return '-';
        return this.currentStats.custom[index].value;
    }

    // 获取自定义进度条的百分比
    getCustomProgress(index: number): number {
        const valStr = this.getCustomValue(index);
        const val = parseFloat(valStr);
        if (isNaN(val)) return 0;
        
        const metric = this.customMetrics[index];
        const max = metric.maxValue || 100;
        return Math.min(100, Math.max(0, (val / max) * 100));
    }

    private resolveSession(): any {
        if (this.boundSession) {
            return this.boundSession;
        }

        let activeTab: any = this.app.activeTab;
        if (!activeTab) {
            return null;
        }

        if (activeTab['focusedTab']) {
            activeTab = activeTab['focusedTab'];
        }

        return activeTab['session'] || null;
    }

    ngOnInit() {
        this.loadConfig();
        this.configSubscriptions.push(this.config.ready$.subscribe(() => {
            this.loadConfig();
            setTimeout(() => this.checkAndFetch(), 100);
        }));
        this.configSubscriptions.push(this.config.changed$.subscribe(() => this.loadConfig()));

        if (this.useExternalController) {
            return;
        }

        if (!this.boundSession && (this.app as any).activeTabChange) {
            this.tabSubscription = (this.app as any).activeTabChange.subscribe(() => {
                this.checkAndFetch();
            });
        }
        setTimeout(() => this.checkAndFetch(), 100);
        this.zone.runOutsideAngular(() => {
            this.timerId = window.setInterval(() => {
                this.zone.run(() => { this.checkAndFetch() })
            }, 3000)
        })
    }

    loadConfig() {
        const conf = this.config.store.plugin?.serverStats || {};
        if (conf.style) {
            this.styleConfig = { ...this.styleConfig, ...conf.style };
        }
        // 加载自定义指标配置
        this.customMetrics = conf.customMetrics || [];
        this.cdr.detectChanges();
    }

    formatSpeed(bytes: number): string {
        if (bytes === 0) return '0 B/s';
        const k = 1024;
        const sizes = ['B/s', 'K/s', 'M/s', 'G/s'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    forceUpdate() { this.checkAndFetch() }

    async checkAndFetch() {
        if (this.useExternalController) {
            return;
        }

        const isEnabled = this.config.store.plugin?.serverStats?.enabled;
        const displayMode = this.config.store.plugin?.serverStats?.displayMode || 'bottomBar';
        
        if (displayMode !== 'bottomBar') {
            if (this.visible) {
                this.visible = false;
                this.loading = true;
                this.cdr.detectChanges();
            }
            return;
        }

        const session = this.resolveSession();

        if (!isEnabled || !session) {
            if (this.visible) {
                this.visible = false;
                this.loading = true;
                this.cdr.detectChanges();
            }
            return;
        }

        if (session && this.statsService.isPlatformSupport(session)) {
            if (!this.visible) {
                this.visible = true;
                this.loading = true;
                this.cdr.detectChanges();
            }
            
            try {
                const data = await this.statsService.fetchStats(session)
                this.loading = false;
                if (data) {
                    this.updateStats(data);
                    this.currentStats = data;
                }
                this.cdr.detectChanges();
            } catch (e) {
                this.loading = false;
                this.cdr.detectChanges();
            }
        } else {
            if (this.visible) {
                this.visible = false;
                this.loading = true;
                this.cdr.detectChanges();
            }
        }
    }

    updateStats(stats: { cpu: number, mem: number, disk: number, netRx: number, netTx: number }) {
        this.currentStats = stats
    }

    ngOnDestroy() {
        if (this.timerId) clearInterval(this.timerId)
        if (this.tabSubscription) this.tabSubscription.unsubscribe()
        this.configSubscriptions.forEach(sub => sub.unsubscribe())
    }
}
