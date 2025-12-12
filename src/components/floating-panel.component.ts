import { Component, OnInit, OnDestroy, ViewChild, ChangeDetectorRef, NgZone, HostListener, ViewChildren, QueryList } from '@angular/core'
import { Subscription } from 'rxjs'
import { AppService, ConfigService } from 'tabby-core'
import { BaseChartDirective } from 'ng2-charts'
import { ChartConfiguration, ChartData, ChartType } from 'chart.js'
import { StatsService } from '../services/stats.service'
import { CustomMetric } from '../config'

@Component({
    selector: 'server-stats-floating-panel',
    template: `
        <div class="stats-container" 
             *ngIf="visible"
             (mousedown)="startDrag($event)"
             [style.top.px]="pos.y" 
             [style.left.px]="pos.x"
             [style.right]="pos.x !== null ? 'auto' : null"
             [style.background]="styleConfig.background"
             [style.flex-direction]="styleConfig.layout === 'horizontal' ? 'row' : 'column'">
             
            <!-- 基础指标 -->
            <div class="chart-wrapper" 
                 [style.width.px]="styleConfig.size" 
                 [style.height.px]="styleConfig.size">
                <div class="chart-label">{{ 'CPU' | translate }}</div>
                <canvas baseChart [data]="cpuData" [options]="chartOptions" [type]="doughnutChartType"></canvas>
                <div class="chart-value">{{currentStats.cpu | number:'1.0-0'}}%</div>
            </div>

            <div class="chart-wrapper" 
                 [style.width.px]="styleConfig.size" 
                 [style.height.px]="styleConfig.size">
                <div class="chart-label">{{ 'RAM' | translate }}</div>
                <canvas baseChart [data]="memData" [options]="chartOptions" [type]="doughnutChartType"></canvas>
                <div class="chart-value">{{currentStats.mem | number:'1.0-0'}}%</div>
            </div>

            <div class="chart-wrapper" 
                 [style.width.px]="styleConfig.size" 
                 [style.height.px]="styleConfig.size">
                <div class="chart-label">{{ 'DISK' | translate }}</div>
                <canvas baseChart [data]="diskData" [options]="chartOptions" [type]="doughnutChartType"></canvas>
                <div class="chart-value">{{currentStats.disk | number:'1.0-0'}}%</div>
            </div>

            <!-- 自定义指标 -->
            <ng-container *ngFor="let metric of customMetrics; let i = index">
                <div class="chart-wrapper" 
                     [style.width.px]="styleConfig.size" 
                     [style.height.px]="styleConfig.size">
                    <div class="chart-label">{{ metric.label }}</div>
                    
                    <ng-container *ngIf="metric.type === 'progress'">
                         <canvas baseChart [data]="customChartsData[i]" [options]="chartOptions" [type]="doughnutChartType"></canvas>
                         <div class="chart-value">{{ getCustomValue(i) }}</div>
                    </ng-container>

                    <ng-container *ngIf="metric.type === 'text'">
                         <div class="text-value-container" [style.color]="metric.color || '#fff'">
                            {{ getCustomValue(i) }}<span class="unit">{{ metric.suffix }}</span>
                         </div>
                    </ng-container>
                </div>
            </ng-container>

            <!-- 网络流量 -->
            <div class="chart-wrapper" 
                 [style.width.px]="styleConfig.size" 
                 [style.height.px]="styleConfig.size">
                <div class="chart-label">{{ 'NET' | translate }}</div>
                <div class="net-container">
                    <div class="net-row download">
                         <span>↓</span> {{ formatSpeed(currentStats.netRx) }}
                    </div>
                    <div class="net-row upload">
                         <span>↑</span> {{ formatSpeed(currentStats.netTx) }}
                    </div>
                </div>
            </div>
        </div>
    `,
    styles: [`
        :host { display: block; position: absolute; z-index: 99999; }
        .stats-container {
            position: fixed;
            top: 100px; 
            right: 20px; 
            z-index: 10000; 
            backdrop-filter: blur(12px);
            padding: 0px 10px 0px 10px;
            display: flex; 
            gap: 15px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.2);
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            min-width: 100px;
            color: white;
            cursor: move;
            user-select: none;
        }
        .chart-wrapper { position: relative; display: flex; flex-direction: column; align-items: center; container-type: inline-size; }
        
        .chart-label { font-size: 12cqw; font-weight: bold; margin-bottom: 2cqw; color: #aaa; pointer-events: none; margin-top: 5cqw }
        .chart-value { position: absolute; top: calc(50% + 10cqw); left: 50%; transform: translate(-50%, -50%); font-size: 25cqw; font-family: monospace; pointer-events: none; color: #fff; font-weight: bold; text-shadow: 0 1px 2px black; }
        
        .net-container { 
            height: 100%; width: 100%; 
            display: flex; flex-direction: column; justify-content: center; align-items: center; 
            font-family: monospace; font-weight: bold;
        }
        .net-row { font-size: 13cqw; white-space: nowrap; }
        .net-row span { display: inline-block; width: 8cqw; }
        .download { color: #2ecc71; margin-bottom: 2cqw; }
        .upload { color: #e74c3c; }
        
        .text-value-container {
            position: absolute;
            top: calc(50% + 5cqw); left: 50%;
            transform: translate(-50%, -50%);
            font-size: 20cqw;
            font-family: monospace;
            font-weight: bold;
            text-align: center;
            width: 100%;
            text-shadow: 0 1px 2px black;
        }
        .unit { font-size: 0.5em; margin-left: 2px; opacity: 0.8; }
        
        canvas { max-width: calc(100% - 32cqw); max-height: calc(100% - 32cqw); pointer-events: none; }
    `]
})
export class ServerStatsFloatingPanelComponent implements OnInit, OnDestroy {
    @ViewChildren(BaseChartDirective) charts: QueryList<BaseChartDirective> | undefined
    visible = false
    currentStats: any = { cpu: 0, mem: 0, disk: 0, netRx: 0, netTx: 0, custom: [] }
    
    customMetrics: CustomMetric[] = []
    customChartsData: ChartData<'doughnut'>[] = []

    private isDragging = false
    private dragOffset = { x: 0, y: 0 }
    private dragDimensions = { width: 0, height: 0 }
    public pos = { x: null as number | null, y: null as number | null }
    public styleConfig = { background: 'rgba(20, 20, 20, 0.90)', size: 100, layout: 'vertical' }
    private timerId: any = null
    private tabSubscription: Subscription | null = null
    public doughnutChartType: ChartType = 'doughnut'
    public chartOptions: ChartConfiguration<'doughnut'>['options'] = {
        responsive: true, maintainAspectRatio: false, cutout: '75%', 
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        animation: { duration: 0 },
        events: [] 
    }
    public cpuData = this.createChartData('#e74c3c')
    public memData = this.createChartData('#f1c40f')
    public diskData = this.createChartData('#3498db')

    constructor(
        private statsService: StatsService,
        private config: ConfigService,
        private app: AppService,
        private cdr: ChangeDetectorRef,
        private zone: NgZone
    ) {
        (window as any).serverStatsFloating = this;
    }

    private createChartData(color: string): ChartData<'doughnut'> {
        return {
            labels: ['Used', 'Free'],
            datasets: [{ data: [0, 100], backgroundColor: [color, 'rgba(255,255,255,0.1)'], borderWidth: 0 }]
        }
    }

    ngOnInit() {
        this.loadConfig();
        this.config.ready$.subscribe(() => {
            this.loadConfig();
            setTimeout(() => this.checkAndFetch(), 100);
        });
        this.config.changed$.subscribe(() => this.loadConfig());

        this.tabSubscription = (this.app as any).activeTabChange.subscribe(() => {
            this.checkAndFetch();
        });

        setTimeout(() => this.checkAndFetch(), 100);

        this.zone.runOutsideAngular(() => {
            this.timerId = window.setInterval(() => {
                this.zone.run(() => {
                    this.checkAndFetch()
                })
            }, 3000)
        })
    }

    loadConfig() {
        const conf = this.config.store.plugin?.serverStats || {};
        if (conf.location) {
            this.pos = { x: conf.location.x, y: conf.location.y };
        } else {
            this.pos = { x: null, y: null };
        }
        if (conf.style) {
            this.styleConfig = { ...this.styleConfig, ...conf.style };
        }

        // 加载自定义指标
        this.customMetrics = conf.customMetrics || [];
        this.customChartsData = this.customMetrics.map(m => 
            this.createChartData(m.color || '#00ff00')
        );

        setTimeout(() => this.adjustPositionToViewport(), 100);
        this.cdr.detectChanges();
    }

    formatSpeed(bytes: number): string {
        if (bytes === 0) return '0 B/s';
        const k = 1024;
        const sizes = ['B/s', 'K/s', 'M/s', 'G/s'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    startDrag(event: MouseEvent) {
        if (event.button !== 0) return; 
        this.isDragging = true;
        const target = event.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        this.dragDimensions.width = rect.width;
        this.dragDimensions.height = rect.height;
        this.dragOffset.x = event.clientX - rect.left;
        this.dragOffset.y = event.clientY - rect.top;
        event.preventDefault(); 
    }

    @HostListener('document:mousemove', ['$event'])
    onMouseMove(event: MouseEvent) {
        if (!this.isDragging) return;
        let newX = event.clientX - this.dragOffset.x;
        let newY = event.clientY - this.dragOffset.y;
        const maxX = window.innerWidth - this.dragDimensions.width;
        const maxY = window.innerHeight - this.dragDimensions.height;
        this.pos.x = Math.min(Math.max(0, newX), maxX);
        this.pos.y = Math.min(Math.max(0, newY), maxY);
    }

    @HostListener('document:mouseup')
    onMouseUp() {
        if (this.isDragging) {
            this.isDragging = false;
            this.adjustPositionToViewport();
            if (!this.config.store.plugin.serverStats) {
                this.config.store.plugin.serverStats = {};
            }
            if (!this.config.store.plugin.serverStats.location) {
                this.config.store.plugin.serverStats.location = {};
            }
            this.config.store.plugin.serverStats.location.x = this.pos.x;
            this.config.store.plugin.serverStats.location.y = this.pos.y;
            this.config.save();
        }
    }

    private adjustPositionToViewport() {
        if (this.pos.x === null || this.pos.y === null) return
        const rect = (this as any)._elementRef?.nativeElement?.getBoundingClientRect
            ? (this as any)._elementRef.nativeElement.getBoundingClientRect()
            : { width: this.styleConfig.size * 4 + 60, height: this.styleConfig.size }
        const padding = 10
        const maxX = window.innerWidth - rect.width - padding
        const maxY = window.innerHeight - rect.height - padding
        let x = this.pos.x
        let y = this.pos.y
        if (x < padding) x = padding
        if (x > maxX) x = maxX
        if (y < padding) y = padding
        if (y > maxY) y = maxY
        if (x !== this.pos.x || y !== this.pos.y) {
            this.pos.x = x
            this.pos.y = y
            this.cdr.detectChanges()
        }
    }

    @HostListener('window:resize')
    onWindowResize() {
        this.adjustPositionToViewport();
    }

    forceUpdate() { this.checkAndFetch() }

    async checkAndFetch() {
        const isEnabled = this.config.store.plugin?.serverStats?.enabled;
        const displayMode = this.config.store.plugin?.serverStats?.displayMode || 'bottomBar';
        if (displayMode !== 'floatingPanel') {
            if (this.visible) {
                this.visible = false;
                this.cdr.detectChanges();
            }
            return;
        }
        let activeTab: any = this.app.activeTab
        if (!isEnabled || !activeTab) {
            if (this.visible) {
                this.visible = false;
                this.cdr.detectChanges();
            }
            return;
        }
        if (activeTab['focusedTab']) {
            activeTab = activeTab['focusedTab'];
        }
        const session = activeTab['session'];
        if (session) {
            try {
                const data = await this.statsService.fetchStats(session)
                if (data) {
                    this.visible = true; 
                    this.updateCharts(data);
                    this.cdr.detectChanges();
                    return;
                }
            } catch (e) {}
        }
        if (this.visible) {
            this.visible = false;
            this.cdr.detectChanges();
        }
    }

    getCustomValue(index: number): string {
        if (!this.currentStats.custom || !this.currentStats.custom[index]) return '-';
        return this.currentStats.custom[index].value;
    }

    updateCharts(stats: any) {
        this.currentStats = stats
        
        // 更新基础图表
        this.cpuData.datasets[0].data = [stats.cpu, 100 - stats.cpu]
        this.memData.datasets[0].data = [stats.mem, 100 - stats.mem]
        this.diskData.datasets[0].data = [stats.disk, 100 - stats.disk]
        this.cpuData = { ...this.cpuData }
        this.memData = { ...this.memData }
        this.diskData = { ...this.diskData }

        // 更新自定义图表
        if (stats.custom && Array.isArray(stats.custom)) {
            stats.custom.forEach((item: any, index: number) => {
                const metric = this.customMetrics[index];
                if (metric && metric.type === 'progress' && this.customChartsData[index]) {
                    const val = parseFloat(item.value) || 0;
                    const max = metric.maxValue || 100;
                    const remain = Math.max(0, max - val);
                    this.customChartsData[index].datasets[0].data = [val, remain];
                    this.customChartsData[index] = { ...this.customChartsData[index] };
                }
            });
        }
        
        // 通知所有图表组件更新
        if (this.charts) {
            this.charts.forEach(c => c.update());
        }
    }

    ngOnDestroy() {
        if (this.timerId) clearInterval(this.timerId)
        if (this.tabSubscription) this.tabSubscription.unsubscribe()
    }
}