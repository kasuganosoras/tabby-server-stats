import { 
    NgModule, Injectable, Component, OnInit, OnDestroy, 
    ViewChild, ComponentFactoryResolver, ApplicationRef, Injector, EmbeddedViewRef,
    ChangeDetectorRef, NgZone, HostListener
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import TabbyCoreModule, { ToolbarButtonProvider, ToolbarButton, AppService, ConfigService, ConfigProvider, TranslateService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { NgChartsModule, BaseChartDirective } from 'ng2-charts'
import { ChartConfiguration, ChartData, ChartType } from 'chart.js'
import { Subscription } from 'rxjs'

const TRANSLATIONS = {
    'zh-CN': {
        'Server Stats': '服务器状态',
        'Appearance': '外观',
        'Display Mode': '显示模式',
        'Floating Panel': '浮动面板',
        'Bottom Bar': '底部栏',
        'Layout Direction': '排列方向',
        'Vertical': '纵向',
        'Horizontal': '横向',
        'Background Color': '背景颜色',
        'Opacity': '不透明度',
        'Chart Size': '图表大小',
        'Panel Position': '面板位置',
        'Reset Position': '重置位置',
        'Show Server Stats': '显示服务器状态',
        'CPU': 'CPU',
        'RAM': '内存',
        'DISK': '磁盘',
        'NET': '网络',
        'Reset Panel Position': '重置面板位置',
        'Reset': '重置',
        'Vertical or Horizontal layout': '纵向或横向排列',
        'Background color and opacity': '背景颜色与不透明度',
        'Unit: px': '单位：像素',
        'Reset to default position': '重置回默认位置',
        'Layout': '布局',
    }
};

@Injectable()
export class ServerStatsConfigProvider extends ConfigProvider {
    defaults = {
        plugin: {
            serverStats: {
                enabled: true,
                displayMode: 'floatingPanel', // 'floatingPanel' or 'bottomBar'
                location: { x: null, y: null },
                style: {
                    background: 'rgba(20, 20, 20, 0.90)',
                    size: 100,
                    layout: 'vertical'
                }
            }
        }
    }
}

@Injectable({ providedIn: 'root' })
export class StatsService {
    private statsCommand = `
    stats=$( (grep 'cpu ' /proc/stat; awk 'NR>2 {r+=$2; t+=$10} END{print r, t}' /proc/net/dev; sleep 1; grep 'cpu ' /proc/stat; awk 'NR>2 {r+=$2; t+=$10} END{print r, t}' /proc/net/dev) | awk 'NR==1 {t1=$2+$3+$4+$5+$6+$7+$8; i1=$5} NR==2 {rx1=$1; tx1=$2} NR==3 {t2=$2+$3+$4+$5+$6+$7+$8; i2=$5} NR==4 {rx2=$1; tx2=$2} END { dt=t2-t1; di=i2-i1; cpu=(dt<=0)?0:(dt-di)/dt*100; rx=rx2-rx1; tx=tx2-tx1; printf "%.1f %.0f %.0f", cpu, rx, tx }' );
    mem=$(free | awk 'NR==2{printf "%.2f", $3*100/$2 }');
    disk=$(df -h / | awk 'NR==2{print $5}' | sed 's/%//');
    echo "TABBY-STATS-START $stats $mem $disk TABBY-STATS-END"
    `
    private isFetching = false;
    async fetchStats(session: any): Promise<{ cpu: number, mem: number, disk: number, netRx: number, netTx: number } | null> {
        if (!session || this.isFetching) return null;
        
        this.isFetching = true;
        
        try {
            const sshClient = session.ssh && session.ssh.ssh ? session.ssh.ssh : null;
            if (!sshClient || typeof sshClient.openSessionChannel !== 'function') {
                this.isFetching = false;
                return null;
            }
            const output = await this.exec(sshClient, this.statsCommand);
            if (!output) {
                this.isFetching = false;
                return null;
            }
            const match = output.match(/TABBY-STATS-START\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)/);

            if (match && match.length >= 6) {
                this.isFetching = false;
                return {
                    cpu: parseFloat(match[1]) || 0,
                    netRx: parseFloat(match[2]) || 0,
                    netTx: parseFloat(match[3]) || 0,
                    mem: parseFloat(match[4]) || 0,
                    disk: parseFloat(match[5]) || 0
                };
            }
        } catch (e) {
            // console.error('Stats: Fetch Error:', e);
        }
        
        this.isFetching = false;
        return null;
    }

    private async exec(sshClient: any, cmd: string): Promise<string> {
        const timeout = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Stats: Timeout')), 5000)
        );

        const run = async () => {
            let channel: any = null;
            try {
                const newChannel = await sshClient.openSessionChannel();
                channel = await sshClient.activateChannel(newChannel);
            } catch (err) {
                throw err;
            }

            return new Promise<string>((resolve, reject) => {
                let buffer = '';
                let resolved = false;
                let subscription: any = null;
                const decoder = new TextDecoder('utf-8');

                const cleanup = () => {
                    if (subscription) subscription.unsubscribe();
                    if (channel) {
                        try { channel.close(); } catch(e){}
                    }
                };

                const processData = (chunk: any) => {
                    let text = '';
                    if (typeof chunk === 'string') {
                        text = chunk;
                    } else if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
                        text = decoder.decode(chunk, { stream: true });
                    } else {
                        text = chunk.toString();
                    }

                    buffer += text;
                    
                    if (!resolved && buffer.includes('TABBY-STATS-END')) {
                        resolved = true;
                        cleanup();
                        resolve(buffer);
                    }
                };

                if (channel.data$) {
                    subscription = channel.data$.subscribe(
                        (data: any) => processData(data), 
                        (err: any) => console.error('Stats: Data Stream Error', err)
                    );
                } else {
                    cleanup();
                    reject(new Error('Channel has no data$ observable'));
                    return;
                }

                if (typeof channel.requestExec === 'function') {
                    channel.requestExec(cmd).catch((err: any) => {
                        cleanup();
                        reject(err);
                    });
                } else if (typeof channel.exec === 'function') {
                    channel.exec(cmd).catch((err: any) => {
                        cleanup();
                        reject(err);
                    });
                } else {
                    cleanup();
                    reject(new Error('Channel has no requestExec or exec method'));
                }
            });
        };

        return Promise.race([run(), timeout]);
    }
}

@Component({
    template: `
        <h3 translate>Server Stats</h3>
        
        <div class="form-line">
            <div class="header">
                <div class="title" translate>Display Mode</div>
                <div class="description">Choose between floating panel or bottom bar</div>
            </div>
            <div class="btn-group">
                <input type="radio" class="btn-check" name="displayMode" id="displayModeFloating" 
                    autocomplete="off" value="floatingPanel"
                    [(ngModel)]="config.store.plugin.serverStats.displayMode" 
                    (ngModelChange)="save()">
                <label class="btn btn-secondary" for="displayModeFloating" translate>Floating Panel</label>
                <input type="radio" class="btn-check" name="displayMode" id="displayModeBottom" 
                    autocomplete="off" value="bottomBar"
                    [(ngModel)]="config.store.plugin.serverStats.displayMode" 
                    (ngModelChange)="save()">
                <label class="btn btn-secondary" for="displayModeBottom" translate>Bottom Bar</label>
            </div>
        </div>

        <div class="form-line" *ngIf="config.store.plugin.serverStats.displayMode === 'floatingPanel'">
             <div class="header">
                <div class="title" translate>Layout Direction</div>
                <div class="description" translate>Vertical or Horizontal layout</div>
             </div>
             <div class="btn-group">
                <input type="radio" class="btn-check" name="layout" id="layoutVertical" 
                    autocomplete="off" value="vertical"
                    [(ngModel)]="config.store.plugin.serverStats.style.layout" 
                    (ngModelChange)="save()">
                <label class="btn btn-secondary" for="layoutVertical" translate>Vertical</label>
                <input type="radio" class="btn-check" name="layout" id="layoutHorizontal" 
                    autocomplete="off" value="horizontal"
                    [(ngModel)]="config.store.plugin.serverStats.style.layout" 
                    (ngModelChange)="save()">
                <label class="btn btn-secondary" for="layoutHorizontal" translate>Horizontal</label>
             </div>
        </div>

        <div class="form-line">
            <div class="header">
                <div class="title" translate>Background Color</div>
                <div class="description" translate>Background color and opacity</div>
            </div>
            <div class="d-flex align-items-center">
                <input type="color" class="form-control form-control-color me-3" 
                    style="width: 60px;"
                    [ngModel]="hexColor" 
                    (ngModelChange)="setHexColor($event)">
                
                <span class="text-muted me-2" translate>Opacity</span>
                <input type="range" class="form-range me-2" style="width: 100px" min="0" max="1" step="0.01"
                    [ngModel]="opacity" 
                    (ngModelChange)="setOpacity($event)">
                <span class="text-muted">{{ (opacity * 100) | number:'1.0-0' }}%</span>
            </div>
        </div>

        <div class="form-line" *ngIf="config.store.plugin.serverStats.displayMode === 'floatingPanel'">
            <div class="header">
                <div class="title" translate>Chart Size</div>
                <div class="description" translate>Unit: px</div>
            </div>
            <input class="me-3" type="range" min="50" max="300" step="5"
                [(ngModel)]="config.store.plugin.serverStats.style.size" 
                (mouseup)="save()">
            <button class="btn btn-outline-secondary me-3" (click)="resetSize()" ngbTooltip="{{ 'Reset' | translate }}">
                <i class="fas fa-rotate-left"></i>
            </button>
            <input class="form-control param-input" type="number" 
                [(ngModel)]="config.store.plugin.serverStats.style.size" 
                (ngModelChange)="save()">
        </div>

        <div class="form-line" *ngIf="config.store.plugin.serverStats.displayMode === 'floatingPanel'">
            <div class="header">
                <div class="title" translate>Panel Position</div>
                <div class="description" translate>Reset to default position</div>
            </div>
            <button class="btn btn-warning" (click)="resetPosition()">
                <i class="fas fa-undo mr-2"></i>
                <span translate>Reset Position</span>
            </button>
        </div>

    `,
    styles: [`
        .param-input {
            width: 80px;
            text-align: right;
        }
    `]
})
export class ServerStatsSettingsComponent {
    constructor(public config: ConfigService) {}

    get hexColor(): string {
        const bg = this.config.store.plugin.serverStats.style.background;
        if (!bg) return '#141414';
        
        if (bg.startsWith('rgba')) {
            const parts = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (parts) {
                const r = parseInt(parts[1]).toString(16).padStart(2, '0');
                const g = parseInt(parts[2]).toString(16).padStart(2, '0');
                const b = parseInt(parts[3]).toString(16).padStart(2, '0');
                return `#${r}${g}${b}`;
            }
        }
        if (bg.startsWith('#')) return bg.substring(0, 7);
        return '#141414';
    }

    get opacity(): number {
        const bg = this.config.store.plugin.serverStats.style.background;
        if (!bg) return 0.9;
        
        if (bg.startsWith('rgba')) {
            const parts = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (parts && parts[4]) {
                return parseFloat(parts[4]);
            }
        }
        return 1.0;
    }

    setHexColor(hex: string) {
        const currentOpacity = this.opacity;
        this.updateColor(hex, currentOpacity);
    }

    setOpacity(val: number) {
        const currentHex = this.hexColor;
        this.updateColor(currentHex, val);
    }

    private updateColor(hex: string, opacity: number) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        
        this.config.store.plugin.serverStats.style.background = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        this.save();
    }

    save() {
        this.config.save();
    }

    resetSize() {
        this.config.store.plugin.serverStats.style.size = 100;
        this.save();
    }

    resetPosition() {
        if (this.config.store.plugin.serverStats && this.config.store.plugin.serverStats.location) {
            this.config.store.plugin.serverStats.location.x = null;
            this.config.store.plugin.serverStats.location.y = null;
            this.config.save();
        }
    }

}

@Injectable()
export class ServerStatsSettingsTabProvider extends SettingsTabProvider {
    id = 'server-stats';
    icon = 'fas fa-server'; 
    title = 'Server Stats';

    getComponentType(): any {
        return ServerStatsSettingsComponent;
    }
}

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
        
        canvas { max-width: calc(100% - 32cqw); max-height: calc(100% - 32cqw); pointer-events: none; }
    `]
})
export class ServerStatsFloatingPanelComponent implements OnInit, OnDestroy {
    @ViewChild(BaseChartDirective) chart: BaseChartDirective | undefined
    visible = false
    currentStats = { cpu: 0, mem: 0, disk: 0, netRx: 0, netTx: 0 }

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

    updateCharts(stats: { cpu: number, mem: number, disk: number, netRx: number, netTx: number }) {
        this.currentStats = stats
        this.cpuData.datasets[0].data = [stats.cpu, 100 - stats.cpu]
        this.memData.datasets[0].data = [stats.mem, 100 - stats.mem]
        this.diskData.datasets[0].data = [stats.disk, 100 - stats.disk]
        this.chart?.update()
        this.cpuData = { ...this.cpuData }
        this.memData = { ...this.memData }
        this.diskData = { ...this.diskData }
    }

    ngOnDestroy() {
        if (this.timerId) clearInterval(this.timerId)
        if (this.tabSubscription) this.tabSubscription.unsubscribe()
    }
}

@Component({
    selector: 'server-stats-bottom-bar',
    template: `
        <div class="stats-container" 
             *ngIf="visible"
             [style.background]="styleConfig.background">
            <div class="stat-section" *ngIf="loading">
                <div class="loading-text">Loading server stats...</div>
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
        :host { 
            display: block; 
            position: fixed; 
            bottom: 0; 
            left: 0; 
            right: 0; 
            z-index: 10000; 
            width: 100%;
        }
        .stats-container {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            width: 100%;
            z-index: 10000; 
            backdrop-filter: blur(8px);
            padding: 4px 12px;
            display: flex; 
            gap: 12px;
            justify-content: flex-start;
            align-items: center;
            border-top: 1px solid rgba(255,255,255,0.15);
            min-height: 28px;
            max-height: 28px;
            color: rgba(255,255,255,0.9);
            user-select: none;
            font-size: 11px;
        }
        .stat-section {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .stat-label {
            font-weight: 500;
            color: rgba(255,255,255,0.7);
            font-size: 10px;
            line-height: 1;
            min-width: 32px;
        }
        .stat-content {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .progress-bar-container {
            height: 6px;
            background-color: rgba(255,255,255,0.1);
            border-radius: 3px;
            overflow: hidden;
            width: 60px;
        }
        .progress-bar {
            height: 100%;
            transition: width 0.3s ease, background-color 0.3s ease;
            border-radius: 3px;
        }
        .stat-value {
            font-family: monospace;
            font-size: 10px;
            color: rgba(255,255,255,0.9);
            line-height: 1;
            white-space: nowrap;
            min-width: 32px;
            text-align: left;
        }
        .stat-separator {
            width: 1px;
            height: 16px;
            background-color: rgba(255,255,255,0.2);
            margin: 0 4px;
        }
        .net-section {
            min-width: 120px;
        }
        .net-container { 
            display: flex; 
            flex-direction: row;
            gap: 8px;
            font-family: monospace;
            font-size: 10px;
            align-items: center;
        }
        .net-row { 
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 3px;
            line-height: 1;
        }
        .net-row span { 
            display: inline-block;
        }
        .net-value {
            display: inline-block;
            min-width: 45px;
            text-align: left;
        }
        .download { color: #2ecc71; }
        .upload { color: #e74c3c; }
        .loading-text {
            color: rgba(255,255,255,0.6);
            font-size: 10px;
            font-style: italic;
        }
    `]
})

export class ServerStatsBottomBarComponent implements OnInit, OnDestroy {
    visible = false
    loading = true
    currentStats = { cpu: 0, mem: 0, disk: 0, netRx: 0, netTx: 0 }

    public styleConfig = { background: 'rgba(20, 20, 20, 0.85)' }
    private timerId: any = null
    private tabSubscription: Subscription | null = null

    constructor(
        private statsService: StatsService,
        private config: ConfigService,
        private app: AppService,
        private cdr: ChangeDetectorRef,
        private zone: NgZone
    ) {
        (window as any).serverStatsBottomBar = this;
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

        if (conf.style) {
            this.styleConfig = { ...this.styleConfig, ...conf.style };
        }
        
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

        let activeTab: any = this.app.activeTab

        if (!isEnabled || !activeTab) {
            if (this.visible) {
                this.visible = false;
                this.loading = true;
                this.cdr.detectChanges();
            }
            return;
        }

        if (activeTab['focusedTab']) {
            activeTab = activeTab['focusedTab'];
        }

        const session = activeTab['session'];
        
        if (session) {
            if (!this.visible) {
                this.visible = true;
                this.loading = true;
                this.cdr.detectChanges();
            }
            
            try {
                const data = await this.statsService.fetchStats(session)
                if (data) {
                    this.loading = false;
                    this.updateStats(data);
                    this.cdr.detectChanges();
                    return;
                }
            } catch (e) {
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
    }
}


@Injectable()
export class StatsToolbarButtonProvider extends ToolbarButtonProvider {
    constructor(private config: ConfigService, private translate: TranslateService) { super() }
    
    provide(): ToolbarButton[] {
        return [{
            icon: require('./icons/activity.svg'),
            title: this.translate.instant('Show Server Stats'),
            click: () => {
                if (!this.config.store.plugin) this.config.store.plugin = {};
                if (!this.config.store.plugin.serverStats) this.config.store.plugin.serverStats = {};
                
                const current = this.config.store.plugin.serverStats.enabled
                this.config.store.plugin.serverStats.enabled = !current
                this.config.save();

                const floatingComponent = (window as any).serverStatsFloating;
                const bottomBarComponent = (window as any).serverStatsBottomBar;
                if (floatingComponent) floatingComponent.forceUpdate();
                if (bottomBarComponent) bottomBarComponent.forceUpdate();
            }
        }]
    }
}

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
                document.body.appendChild(this.bottomBarElem);
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
