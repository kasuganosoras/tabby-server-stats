import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core'
import { DomSanitizer, SafeUrl } from '@angular/platform-browser'
import { Subscription } from 'rxjs'
import { AppService, ConfigService } from 'tabby-core'
import { StatsService } from '../services/stats.service'
import { CustomMetric, evaluateColor, formatFontAwesomeIcon, getSvgPresetPath, isUrlOrDataUri, isFaIcon, DEFAULT_METRIC_ICONS } from '../config'

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
                <ng-container *ngIf="defaultMetrics.cpu">
                    <div class="stat-section">
                        <div class="stat-label">
                            <i *ngIf="showDefaultIcons" [class]="getIconClass(defaultIcons.cpu)" style="font-size: 11px;"></i>
                            <span>{{ 'CPU' | translate }}</span>
                        </div>
                        <div class="stat-content">
                            <div class="progress-bar-container">
                                <div class="progress-bar" [style.width.%]="currentStats.cpu" [style.background-color]="getCpuColor()"></div>
                            </div>
                            <div class="stat-value">{{currentStats.cpu | number:'1.0-0'}}%</div>
                        </div>
                    </div>
                    <div class="stat-separator"></div>
                </ng-container>

                <ng-container *ngIf="defaultMetrics.ram">
                    <div class="stat-section">
                        <div class="stat-label">
                            <i *ngIf="showDefaultIcons" [class]="getIconClass(defaultIcons.ram)" style="font-size: 11px;"></i>
                            <span>{{ 'RAM' | translate }}</span>
                        </div>
                        <div class="stat-content">
                            <div class="progress-bar-container">
                                <div class="progress-bar" [style.width.%]="currentStats.mem" [style.background-color]="getMemColor()"></div>
                            </div>
                            <div class="stat-value">{{currentStats.mem | number:'1.0-0'}}%</div>
                        </div>
                    </div>
                    <div class="stat-separator"></div>
                </ng-container>

                <ng-container *ngIf="defaultMetrics.disk">
                    <div class="stat-section">
                        <div class="stat-label">
                            <i *ngIf="showDefaultIcons" [class]="getIconClass(defaultIcons.disk)" style="font-size: 11px;"></i>
                            <span>{{ 'DISK' | translate }}</span>
                        </div>
                        <div class="stat-content">
                            <div class="progress-bar-container" *ngIf="currentStats.disk > 0">
                                <div class="progress-bar" [style.width.%]="currentStats.disk" [style.background-color]="getDiskColor()"></div>
                            </div>
                            <div class="stat-value" [class.text-muted]="!currentStats.disk">
                                {{ currentStats.disk > 0 ? (currentStats.disk | number:'1.0-0') + '%' : '-' }}
                            </div>
                        </div>
                    </div>
                    <div class="stat-separator" *ngIf="customMetrics.length > 0 || defaultMetrics.net"></div>
                </ng-container>

                <ng-container *ngFor="let metric of customMetrics; let i = index">
                    <div class="stat-section">
                        <div class="stat-label">
                            <ng-container *ngIf="metric.icon">
                                <svg *ngIf="getSvgPath(metric.icon)" 
                                     viewBox="0 0 24 24" 
                                     width="12" height="12" 
                                     fill="currentColor"
                                     style="flex-shrink: 0; vertical-align: -1px;">
                                    <path [attr.d]="getSvgPath(metric.icon)"></path>
                                </svg>
                                <img *ngIf="isUrl(metric.icon)" 
                                     [src]="getSafeIconUrl(metric.icon)" 
                                     width="12" height="12" 
                                     style="object-fit: contain; flex-shrink: 0; vertical-align: -1px;" />
                                <i *ngIf="isFa(metric.icon)" 
                                   [class]="getIconClass(metric.icon)"
                                   style="font-size: 11px;"></i>
                            </ng-container>
                            <span *ngIf="metric.label">{{ metric.label }}</span>
                        </div>
                        
                        <div class="stat-content" *ngIf="metric.type === 'progress'">
                            <div class="progress-bar-container" *ngIf="getCustomValue(i) !== '-'">
                                <div class="progress-bar" 
                                     [style.width.%]="getCustomProgress(i)" 
                                     [style.background-color]="getCustomMetricColor(metric, i)"></div>
                            </div>
                            <div class="stat-value" [style.color]="getCustomMetricColor(metric, i)">
                                {{ getCustomValue(i) }}<span *ngIf="getCustomValue(i) !== '-'">{{ getMetricSuffix(metric) }}</span>
                            </div>
                        </div>

                        <div class="stat-content" *ngIf="metric.type === 'text'">
                            <div class="stat-value" [style.color]="getCustomMetricColor(metric, i)">
                                {{ getCustomValue(i) }}<span *ngIf="getCustomValue(i) !== '-' && metric.suffix">{{ getMetricSuffix(metric) }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="stat-separator" *ngIf="shouldShowSeparator(i)"></div>
                </ng-container>

                <ng-container *ngIf="defaultMetrics.net">
                    <div class="stat-section net-section">
                        <div class="stat-label">
                            <i *ngIf="showDefaultIcons" [class]="getIconClass(defaultIcons.net)" style="font-size: 11px;"></i>
                            <span>{{ 'NET' | translate }}</span>
                        </div>
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
            padding: 3px 12px;
            display: flex;
            flex-wrap: wrap;
            gap: 4px 10px;
            justify-content: flex-start;
            align-items: center;
            border-top: 1px solid rgba(255,255,255,0.15);
            color: rgba(255,255,255,0.9);
            user-select: none;
            font-size: 11px;
            min-height: 26px;
        }
        .stat-section { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; height: 20px; }
        .stat-label { font-weight: 500; color: rgba(255,255,255,0.7); font-size: 11px; line-height: 1; min-width: 14px; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
        .stat-content { display: inline-flex; align-items: center; gap: 6px; height: 100%; }
        .progress-bar-container { height: 7px; background-color: rgba(255,255,255,0.15); border-radius: 4px; overflow: hidden; width: 50px; display: inline-flex; align-items: center; box-shadow: inset 0 1px 2px rgba(0,0,0,0.35); }
        .progress-bar { height: 100%; transition: width 0.3s ease, background-color 0.3s ease; border-radius: 0; }
        .stat-value { font-family: monospace; font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.9); line-height: 1; white-space: nowrap; text-align: left; max-width: 350px; overflow: hidden; text-overflow: ellipsis; display: inline-flex; align-items: center; }
        .stat-separator { width: 1px; height: 12px; background-color: rgba(255,255,255,0.18); margin: 0 2px; align-self: center; flex: 0 0 1px; }
        .text-muted { color: rgba(255, 255, 255, 0.4) !important; }
        .net-section { min-width: 120px; margin-left: auto; }
        .net-container { display: flex; flex-direction: column; gap: 3px; font-family: monospace; font-size: 10px; align-items: flex-start; }
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
        private zone: NgZone,
        private sanitizer: DomSanitizer
    ) {
    }

    readonly defaultIcons = DEFAULT_METRIC_ICONS;

    get defaultMetrics() {
        return this.config?.store?.plugin?.serverStats?.defaultMetrics || { cpu: true, ram: true, disk: true, net: true };
    }

    get showDefaultIcons(): boolean {
        return this.config?.store?.plugin?.serverStats?.showDefaultIcons !== false;
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
        const cached = this.statsService.getCachedStats(session);
        if (cached) {
            this.currentStats = cached;
            this.loading = false;
        } else {
            this.loading = true;
        }
        this.cdr.detectChanges();
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
        const metric = this.customMetrics[index];
        if (!metric) return '-';
        if (this.currentStats?.custom) {
            const found = this.currentStats.custom.find((c: any) => c.id === metric.id);
            if (found && found.value !== undefined && found.value !== null && found.value !== '-') {
                return found.value;
            }
        }
        const session = this.resolveSession();
        if (session) {
            const cached = this.statsService.getCachedStats(session);
            if (cached?.custom) {
                const found = cached.custom.find((c: any) => c.id === metric.id);
                if (found && found.value !== undefined && found.value !== null && found.value !== '-') {
                    return found.value;
                }
            }
        }
        if (this.currentStats?.custom) {
            const found = this.currentStats.custom.find((c: any) => c.id === metric.id);
            if (found && found.value !== undefined && found.value !== null) {
                return found.value;
            }
        }
        return '-';
    }

    getCustomMetricColor(metric: CustomMetric, index: number): string {
        const val = this.getCustomValue(index);
        if (!val || val === '-') {
            return 'rgba(255, 255, 255, 0.4)';
        }
        if (typeof val === 'string' && val.startsWith('Err:')) {
            return '#e74c3c';
        }
        return evaluateColor(val, metric.colorRules, metric.color || '#3498db');
    }

    shouldShowSeparator(index: number): boolean {
        if (this.defaultMetrics.net) return true;
        return index < this.customMetrics.length - 1;
    }

    getIconClass(icon?: string): string {
        return formatFontAwesomeIcon(icon);
    }

    getSvgPath(icon?: string): string | null {
        return getSvgPresetPath(icon);
    }

    isUrl(icon?: string): boolean {
        return isUrlOrDataUri(icon);
    }

    isFa(icon?: string): boolean {
        return isFaIcon(icon);
    }

    getSafeIconUrl(icon?: string): SafeUrl | string {
        if (!icon) return '';
        if (icon.startsWith('data:image/')) {
            return this.sanitizer.bypassSecurityTrustUrl(icon);
        }
        return icon;
    }

    getMetricSuffix(metric: CustomMetric): string {
        if (metric.suffix !== undefined && metric.suffix !== null && metric.suffix.trim() !== '') {
            const s = metric.suffix.trim();
            return s.startsWith('%') ? s : ' ' + s;
        }
        return metric.type === 'progress' ? '%' : '';
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

        this.configSubscriptions.push(this.statsService.statsUpdated$.subscribe(event => {
            const session = this.resolveSession();
            if (session && this.statsService.getServerKey(session) === event.serverKey) {
                this.visible = true;
                this.loading = false;
                this.updateStats(event.stats);
                this.currentStats = event.stats;
                this.cdr.detectChanges();
            }
        }));

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
            }, 1000)
        })
    }

    loadConfig() {
        const conf = this.config?.store?.plugin?.serverStats || {};
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

        const isEnabled = this.config?.store?.plugin?.serverStats?.enabled;
        const displayMode = this.config?.store?.plugin?.serverStats?.displayMode || 'bottomBar';
        
        if (displayMode !== 'bottomBar') {
            if (this.visible) {
                this.visible = false;
                this.loading = true;
                this.cdr.detectChanges();
            }
            return;
        }

        const session = this.resolveSession();

        if (!isEnabled || !session || session.open === false) {
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
