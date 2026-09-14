import { Component, Injectable, HostListener } from '@angular/core'
import { DomSanitizer, SafeUrl } from '@angular/platform-browser'
import { ConfigService, PlatformService, TranslateService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { 
    CustomMetric, 
    ColorCondition, 
    formatFontAwesomeIcon, 
    getSvgPresetPath, 
    isUrlOrDataUri, 
    isFaIcon,
    POPULAR_ICON_PRESETS
} from '../config'

const PRESETS_URL = 'https://raw.githubusercontent.com/kasuganosoras/tabby-server-stats/main/presets.json';

@Component({
    template: `
        <h3 translate>Server Stats</h3>
        
        <!-- 显示模式选择 -->
        <div class="form-line">
            <div class="header">
                <div class="title" translate>Display Mode</div>
                <div class="description" translate>Choose between floating panel or bottom bar</div>
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

        <!-- 样式配置 -->
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
            </div>
        </div>

        <!-- 默认更新周期配置 -->
        <div class="form-line">
            <div class="header">
                <div class="title" translate>Default Update Interval</div>
                <div class="description" translate>Base interval (in seconds) for collecting metrics</div>
            </div>
            <div class="d-flex align-items-center">
                <input type="number" class="form-control form-control-sm" style="width: 90px;" min="1" max="3600"
                    [(ngModel)]="defaultInterval"
                    (ngModelChange)="save()">
                <span class="text-muted ms-2" translate>seconds</span>
            </div>
        </div>

        <!-- 调试日志配置 -->
        <div class="form-line">
            <div class="header">
                <div class="title" translate>Debug Logging</div>
                <div class="description" translate>Write detailed execution logs to file for troubleshooting</div>
            </div>
            <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" id="debugLogging"
                    [(ngModel)]="debugLogging"
                    (ngModelChange)="save()">
            </div>
        </div>

        <!-- 默认指标配置 -->
        <div class="form-line">
            <div class="header">
                <div class="title" translate>Default Metrics</div>
                <div class="description" translate>Select which default indicators to display</div>
            </div>
            <div class="d-flex flex-column gap-2">
                <div class="d-flex align-items-center gap-3 flex-wrap">
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="metricCpu"
                            [(ngModel)]="defaultMetricsConfig.cpu"
                            (ngModelChange)="save()">
                        <label class="form-check-label" for="metricCpu" translate>CPU Usage</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="metricRam"
                            [(ngModel)]="defaultMetricsConfig.ram"
                            (ngModelChange)="save()">
                        <label class="form-check-label" for="metricRam" translate>RAM Usage</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="metricDisk"
                            [(ngModel)]="defaultMetricsConfig.disk"
                            (ngModelChange)="save()">
                        <label class="form-check-label" for="metricDisk" translate>Disk Usage</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="metricNet"
                            [(ngModel)]="defaultMetricsConfig.net"
                            (ngModelChange)="save()">
                        <label class="form-check-label" for="metricNet" translate>Network Speed</label>
                    </div>
                </div>
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="showDefaultIcons"
                        [(ngModel)]="showDefaultIcons"
                        (ngModelChange)="save()">
                    <label class="form-check-label" for="showDefaultIcons" translate>Show icons for default metrics</label>
                </div>
            </div>
        </div>

        <div class="separator"></div>

        <!-- 预设库区域 -->
        <div class="mt-4 mb-3">
            <div class="d-flex justify-content-between align-items-center mb-2">
                <h4 class="mb-0" translate>Preset Library</h4>
                <button class="btn btn-info btn-sm text-white" (click)="fetchPresets()" [disabled]="loadingPresets">
                    <i class="fas fa-cloud-download-alt me-1"></i>
                    <span *ngIf="!loadingPresets" translate>Fetch from GitHub</span>
                    <span *ngIf="loadingPresets" translate>Loading...</span>
                </button>
            </div>
            <div class="text-muted" style="font-size: 13px;" translate>
                Import commonly used metrics from the community
            </div>

            <!-- 预设列表 -->
            <div style="overflow-x: auto; width: 100%;">
                <div class="list-group mt-3 mb-2" *ngIf="presets.length > 0" style="min-width: 450px">
                    <div class="list-group-item d-flex align-items-center justify-content-between" *ngFor="let p of presets">
                        <div class="d-flex align-items-center" style="width: 90%">
                            <span class="badge me-3" [style.background-color]="p.color || '#666'">
                                {{ (p.type === 'progress' ? 'Progress Bar' : 'Text Value') | translate }}
                            </span>
                            <div class="d-flex align-items-center">
                                <span class="d-inline-flex align-items-center justify-content-center text-primary flex-shrink-0 me-2" *ngIf="p.icon" style="width: 18px; height: 18px;">
                                    <svg *ngIf="getSvgPath(p.icon)" viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                                        <path [attr.d]="getSvgPath(p.icon)"></path>
                                    </svg>
                                    <img *ngIf="isUrl(p.icon)" [src]="getSafeIconUrl(p.icon)" width="15" height="15" style="object-fit: contain;" />
                                    <i *ngIf="isFa(p.icon)" [class]="getIconClass(p.icon)" style="font-size: 15px;"></i>
                                </span>
                                <div>
                                    <strong>{{ p.label }}</strong>
                                    <div class="text-muted" style="font-size: 12px; font-family: monospace;">{{ p.command }}</div>
                                </div>
                            </div>
                        </div>
                        <button class="btn btn-sm btn-success text-white white-space-nowrap add-preset-btn" (click)="addPreset(p)" title="{{ 'Add to my metrics' | translate }}">
                            <i class="fas fa-plus"></i> <span translate>Add</span>
                        </button>
                    </div>
                </div>
                <div class="text-muted" style="font-size: 13px;" translate>
                    <a class="submit-own-preset-btn" href="javascript:void(0);" (click)="openGitHubLink()">{{ 'I want to submit my own preset' | translate }} <i class="fas fa-external-link-alt"></i></a>
                </div>
            </div>
            <div class="alert alert-warning mt-2" *ngIf="fetchError">
                {{ 'Failed to load presets' | translate }}
            </div>
        </div>

        <div class="separator"></div>

        <!-- 自定义指标管理区域 -->
        <div class="mt-4 mb-3">
            <h4 translate>Custom Metrics</h4>
            <div class="text-muted mb-2" style="font-size: 13px;" translate>
                Define custom shell commands to fetch data. The command must output a single value (number or text).
            </div>
        </div>

        <div class="list-group mb-3">
            <div class="list-group-item user-select-none custom-metric-item p-3 mb-2" 
                 *ngFor="let metric of customMetrics; let i = index"
                 draggable="true"
                 (dragstart)="onDragStart(i)"
                 (dragover)="onDragOver($event, i)"
                 (drop)="onDrop(i)"
                 [class.opacity-50]="draggedIndex === i && !isDragging"
                 style="cursor: grab; overflow: hidden;">
                
                <div class="d-flex align-items-start justify-content-between gap-3 w-100">
                    <!-- Drag handle -->
                    <div class="pt-1 flex-shrink-0">
                        <i class="fas fa-grip-vertical text-muted" style="cursor: grab; font-size: 14px;" title="{{ 'Drag to reorder' | translate }}"></i>
                    </div>

                    <!-- Content Area (with min-width: 0 to prevent overflow) -->
                    <div class="flex-grow-1" style="min-width: 0; overflow: hidden;">
                        <!-- Header row: Icon, Label, and Badges -->
                        <div class="d-flex align-items-center flex-wrap gap-2 mb-2">
                            <span class="d-inline-flex align-items-center justify-content-center text-primary flex-shrink-0" *ngIf="metric.icon" style="width: 20px; height: 20px;">
                                <svg *ngIf="getSvgPath(metric.icon)" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                    <path [attr.d]="getSvgPath(metric.icon)"></path>
                                </svg>
                                <img *ngIf="isUrl(metric.icon)" [src]="getSafeIconUrl(metric.icon)" width="16" height="16" style="object-fit: contain;" />
                                <i *ngIf="isFa(metric.icon)" [class]="getIconClass(metric.icon)" style="font-size: 15px;"></i>
                            </span>

                            <strong class="fs-6 text-truncate" style="max-width: 280px;" [title]="metric.label || metric.icon">
                                {{ metric.label || metric.icon }}
                            </strong>

                            <span class="badge" [style.background-color]="metric.color || '#666'">
                                {{ (metric.type === 'progress' ? 'Progress Bar' : 'Text Value') | translate }}
                            </span>

                            <span class="badge bg-secondary" *ngIf="metric.interval" title="{{ 'Execution Interval' | translate }}">
                                <i class="fas fa-clock me-1"></i>{{ metric.interval }}s
                            </span>

                            <span class="badge bg-warning text-dark" *ngIf="metric.timeout" title="{{ 'Timeout' | translate }}">
                                <i class="fas fa-stopwatch me-1"></i>{{ metric.timeout }}s
                            </span>

                            <span class="badge bg-info text-dark" *ngIf="metric.colorRules && metric.colorRules.length > 0" title="{{ 'Conditional Color Rules' | translate }}">
                                <i class="fas fa-palette me-1"></i>{{ metric.colorRules.length }} {{ (metric.colorRules.length === 1 ? 'rule' : 'rules') | translate }}
                            </span>
                        </div>

                        <!-- Command display: elegant monospace code snippet with line-clamp, text-break, and copy tooltip -->
                        <div class="command-box font-monospace text-muted p-2 rounded" 
                             style="font-size: 11px; background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.08); word-break: break-all; max-height: 48px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.4;"
                             [title]="metric.command">
                            {{ metric.command }}
                        </div>
                    </div>

                    <!-- Action buttons: always pinned right, never pushed away -->
                    <div class="btn-group btn-group-sm flex-shrink-0 pt-1">
                        <button class="btn btn-outline-secondary" (click)="editMetric(i)" title="Edit">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="btn btn-outline-danger" (click)="removeMetric(i)" title="Remove">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="list-group-item text-center text-muted p-4" *ngIf="customMetrics.length === 0" translate>
                No custom metrics defined.
            </div>
        </div>

        <div class="list-group mb-3">
            <div class="list-group-item custom-metric-item p-3">
            <h5 class="mb-3">{{ (editingIndex === -1 ? 'Add New Metric' : 'Edit Metric') | translate }}</h5>
            <div class="row g-3">
                <div class="col-md-4">
                    <label class="form-label" translate>Label</label>
                    <input type="text" class="form-control form-control-sm" [(ngModel)]="currentMetric.label" placeholder="{{ 'e.g. PostgreSQL (optional if icon set)' | translate }}">
                </div>
                <div class="col-md-8">
                    <label class="form-label" translate>Icon (FontAwesome or custom SVG)</label>
                    <div class="icon-input-wrap position-relative">
                        <div class="input-group input-group-sm">
                            <span class="input-group-text" *ngIf="currentMetric.icon" style="padding: 0 8px; width: 34px; justify-content: center;">
                                <svg *ngIf="getSvgPath(currentMetric.icon)" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                    <path [attr.d]="getSvgPath(currentMetric.icon)"></path>
                                </svg>
                                <img *ngIf="isUrl(currentMetric.icon)" [src]="getSafeIconUrl(currentMetric.icon)" width="16" height="16" style="object-fit: contain;" />
                                <i *ngIf="isFa(currentMetric.icon)" [class]="getIconClass(currentMetric.icon)"></i>
                            </span>
                            <input type="text" 
                                   class="form-control" 
                                   [(ngModel)]="currentMetric.icon" 
                                   placeholder="{{ 'fa-database, server, redis...' | translate }}">
                            <button type="button" 
                                    class="btn btn-outline-secondary icon-picker-toggle"
                                    (click)="toggleIconPicker($event)"
                                    title="{{ 'Choose preset icon' | translate }}">
                                <i class="fas fa-ellipsis-v"></i>
                            </button>
                            <input type="file" 
                                   #svgFileInput 
                                   accept=".svg,image/svg+xml" 
                                   (change)="onSvgFileSelected($event)" 
                                   style="display: none;">
                            <button type="button" 
                                    class="btn btn-outline-secondary" 
                                    (click)="svgFileInput.click()" 
                                    title="{{ 'Upload Custom SVG' | translate }}">
                                <i class="fas fa-file-upload me-1"></i> <span translate>SVG</span>
                            </button>
                            <button type="button" 
                                    class="btn btn-outline-danger" 
                                    *ngIf="currentMetric.icon" 
                                    (click)="clearIcon()" 
                                    title="{{ 'Remove Icon' | translate }}">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="icon-picker-panel" *ngIf="iconPickerOpen" (click)="$event.stopPropagation()">
                            <div class="icon-picker-title" translate>Preset Icons</div>
                            <div class="icon-picker-grid">
                                <button type="button"
                                        class="icon-picker-item"
                                        *ngFor="let preset of iconPresets"
                                        [class.active]="currentMetric.icon === preset.name"
                                        [title]="preset.label"
                                        (click)="selectPresetIcon(preset.name)">
                                    <svg *ngIf="getSvgPath(preset.name)" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                        <path [attr.d]="getSvgPath(preset.name)"></path>
                                    </svg>
                                    <i *ngIf="isFa(preset.name)" [class]="getIconClass(preset.name)"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="form-text text-muted" style="font-size: 11px;">
                        <span translate>Use FontAwesome (ex: database, server, memory) or upload a custom .svg file</span>
                    </div>
                </div>

                <div class="col-md-3">
                    <label class="form-label" translate>Type</label>
                    <select class="form-select form-select-sm" [(ngModel)]="currentMetric.type">
                        <option value="progress" translate>Progress Bar</option>
                        <option value="text" translate>Text Value</option>
                    </select>
                </div>
                <div class="col-md-3">
                    <label class="form-label" translate>Default Color</label>
                    <input type="color" class="form-control form-control-color form-control-sm w-100" [(ngModel)]="currentMetric.color">
                </div>
                <div class="col-md-3" *ngIf="currentMetric.type === 'progress'">
                    <label class="form-label" translate>Max Value</label>
                    <input type="number" class="form-control form-control-sm" [(ngModel)]="currentMetric.maxValue" placeholder="100">
                </div>
                <div class="col-md-3">
                    <label class="form-label" translate>Suffix</label>
                    <input type="text" class="form-control form-control-sm" [(ngModel)]="currentMetric.suffix" [placeholder]="currentMetric.type === 'progress' ? ('e.g. GB (or % if empty)' | translate) : ('e.g. °C, ms' | translate)">
                </div>
                <div class="col-md-3">
                    <label class="form-label" translate>Interval (sec)</label>
                    <input type="number" min="1" class="form-control form-control-sm" [(ngModel)]="currentMetric.interval" placeholder="{{ defaultInterval }}s">
                </div>
                <div class="col-md-3">
                    <label class="form-label" translate>Timeout (sec)</label>
                    <input type="number" min="1" class="form-control form-control-sm" [(ngModel)]="currentMetric.timeout" placeholder="15s">
                </div>
                <div class="col-12">
                    <label class="form-label" translate>Command (Shell)</label>
                    <div class="input-group input-group-sm">
                        <textarea class="form-control font-monospace" 
                                  rows="2" 
                                  [(ngModel)]="currentMetric.command" 
                                  placeholder="e.g. mongosh ... or redis-cli info | grep used_memory_human"></textarea>
                    </div>
                    <div class="form-text text-muted" style="font-size: 11px;" translate>
                        Command executed on the server. The output (number or text) will be displayed.
                    </div>
                </div>

                <!-- 条件颜色规则区域 -->
                <div class="col-md-12 mt-3">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <label class="form-label mb-0 fw-bold" translate>Conditional Color Rules</label>
                        <button type="button" class="btn btn-outline-primary btn-sm" (click)="addColorRule()">
                            <i class="fas fa-plus me-1"></i> <span translate>Add Rule</span>
                        </button>
                    </div>
                    <div class="text-muted mb-2" style="font-size: 12px;" translate>
                        Color rules are checked from top to bottom. The first matching rule determines the color.
                    </div>

                    <div *ngIf="!currentMetric.colorRules || currentMetric.colorRules.length === 0" class="text-muted fst-italic p-2 border rounded text-center" style="font-size: 12px;">
                        <span translate>No conditional rules defined. Default color will always be used.</span>
                    </div>

                    <div class="border rounded p-2 mb-2 bg-light bg-opacity-10" *ngFor="let rule of currentMetric.colorRules; let rIndex = index">
                        <div class="row g-2 align-items-center">
                            <div class="col-md-4">
                                <select class="form-select form-select-sm" [(ngModel)]="rule.operator">
                                    <option value="==" translate>Equals (==)</option>
                                    <option value="!=" translate>Not Equals (!=)</option>
                                    <option value=">" translate>Greater than (&gt;)</option>
                                    <option value=">=" translate>Greater or Equal (&gt;=)</option>
                                    <option value="<" translate>Less than (&lt;)</option>
                                    <option value="<=" translate>Less or Equal (&lt;=)</option>
                                    <option value="contains" translate>Contains</option>
                                    <option value="not_contains" translate>Not Contains</option>
                                    <option value="starts_with" translate>Starts With</option>
                                    <option value="regex" translate>Regex Match</option>
                                </select>
                            </div>
                            <div class="col-md-4">
                                <input type="text" class="form-control form-control-sm" [(ngModel)]="rule.value" placeholder="{{ 'Threshold / Value' | translate }}">
                            </div>
                            <div class="col-md-3">
                                <input type="color" class="form-control form-control-color form-control-sm w-100" [(ngModel)]="rule.color">
                            </div>
                            <div class="col-md-1 text-end">
                                <button type="button" class="btn btn-outline-danger btn-sm" (click)="removeColorRule(rIndex)">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="col-md-12 mt-3 text-end">
                    <button class="btn btn-secondary btn-sm me-2" *ngIf="editingIndex !== -1" (click)="cancelEdit()" translate>
                        Cancel
                    </button>
                    <button class="btn btn-primary btn-sm text-white" (click)="saveMetric()" [disabled]="(!currentMetric.label && !currentMetric.icon) || !currentMetric.command">
                        <i class="fas" [class.fa-plus]="editingIndex === -1" [class.fa-save]="editingIndex !== -1"></i>
                        &nbsp;
                        {{ (editingIndex === -1 ? 'Add' : 'Save') | translate }}
                    </button>
                </div>
            </div>
            </div>
        </div>
    `,
    styles: [`
        .param-input { width: 80px; text-align: right; }
        .user-select-none { user-select: none; }
        .opacity-50 { opacity: 0.5; }
        .separator { height: 1px; background: rgba(0,0,0,0.1); margin: 20px 0; }
        .white-space-nowrap { white-space: nowrap; }
        .add-preset-btn { width: 12%; justify-content: center; }
        .submit-own-preset-btn { color: #00ffc8ff; text-decoration: none; }
        .submit-own-preset-btn:hover { color: #00daaaff; text-decoration: underline; }
        .custom-metric-item { border: 1px solid rgba(100, 100, 100, 0.15); border-radius: 6px; transition: border-color 0.2s ease; }
        .custom-metric-item:hover { border-color: rgba(255, 255, 255, 0.25); }
        .form-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; margin-bottom: 4px; font-size: 12px; font-weight: 500; }
        .icon-input-wrap { position: relative; }
        .icon-picker-panel {
            position: absolute;
            left: 0;
            right: 0;
            bottom: calc(100% + 6px);
            z-index: 30;
            padding: 10px;
            border-radius: 8px;
            border: 1px solid rgba(120, 120, 120, 0.35);
            background: var(--bs-body-bg, #1e1e1e);
            box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
            max-height: 260px;
            overflow-y: auto;
        }
        .icon-picker-title {
            font-size: 11px;
            font-weight: 600;
            opacity: 0.7;
            margin-bottom: 8px;
        }
        .icon-picker-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
            gap: 6px;
        }
        .icon-picker-item {
            width: 36px;
            height: 36px;
            border-radius: 6px;
            border: 1px solid rgba(120, 120, 120, 0.25);
            background: transparent;
            color: inherit;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            padding: 0;
        }
        .icon-picker-item:hover { border-color: rgba(255, 255, 255, 0.45); background: rgba(255, 255, 255, 0.06); }
        .icon-picker-item.active { border-color: #0d6efd; background: rgba(13, 110, 253, 0.18); }
        :host-context(.theme-dark) .separator { background: rgba(255,255,255,0.1); }
    `]
})
export class ServerStatsSettingsComponent {
    defaultMetric: Partial<CustomMetric> = {
        type: 'progress',
        color: '#00ff00',
        maxValue: 100,
        suffix: '',
        icon: '',
        interval: undefined,
        timeout: undefined,
        colorRules: []
    };
    currentMetric: Partial<CustomMetric> = { ...this.defaultMetric, colorRules: [] };
    editingIndex = -1;
    draggedIndex: number | null = null;
    isDragging = false;
    iconPickerOpen = false;
    iconPresets = POPULAR_ICON_PRESETS;
    
    // 预设相关
    presets: Partial<CustomMetric>[] = [];
    loadingPresets = false;
    fetchError = false;

    constructor(
        private platform: PlatformService,
        public config: ConfigService,
        private sanitizer: DomSanitizer
    ) {}

    @HostListener('document:click')
    onDocumentClick() {
        if (this.iconPickerOpen) {
            this.iconPickerOpen = false;
        }
    }

    toggleIconPicker(event: Event) {
        event.stopPropagation();
        this.iconPickerOpen = !this.iconPickerOpen;
    }

    selectPresetIcon(name: string) {
        this.currentMetric.icon = name;
        this.iconPickerOpen = false;
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

    clearIcon() {
        this.currentMetric.icon = '';
        this.iconPickerOpen = false;
    }

    onSvgFileSelected(event: any) {
        const file = event.target?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e: any) => {
            const result = e.target?.result as string;
            if (result) {
                this.currentMetric.icon = result;
                this.iconPickerOpen = false;
            }
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    }

    get defaultInterval(): number {
        return this.config?.store?.plugin?.serverStats?.defaultInterval || 3;
    }

    set defaultInterval(val: number) {
        if (!this.config?.store?.plugin?.serverStats) return;
        const num = Number(val);
        this.config.store.plugin.serverStats.defaultInterval = isNaN(num) || num < 1 ? 3 : num;
    }

    get debugLogging(): boolean {
        return Boolean(this.config?.store?.plugin?.serverStats?.debugLogging);
    }

    set debugLogging(val: boolean) {
        if (!this.config?.store) {
            return;
        }
        if (!this.config.store.plugin) {
            this.config.store.plugin = {};
        }
        if (!this.config.store.plugin.serverStats) {
            this.config.store.plugin.serverStats = {};
        }
        this.config.store.plugin.serverStats.debugLogging = Boolean(val);
    }

    get showDefaultIcons(): boolean {
        return this.config?.store?.plugin?.serverStats?.showDefaultIcons !== false;
    }

    set showDefaultIcons(val: boolean) {
        if (!this.config?.store) {
            return;
        }
        if (!this.config.store.plugin) {
            this.config.store.plugin = {};
        }
        if (!this.config.store.plugin.serverStats) {
            this.config.store.plugin.serverStats = {};
        }
        this.config.store.plugin.serverStats.showDefaultIcons = Boolean(val);
    }

    addColorRule() {
        if (!this.currentMetric.colorRules) {
            this.currentMetric.colorRules = [];
        }
        this.currentMetric.colorRules.push({
            operator: '==',
            value: '',
            color: '#e74c3c'
        });
    }

    removeColorRule(index: number) {
        if (this.currentMetric.colorRules) {
            this.currentMetric.colorRules.splice(index, 1);
        }
    }

    get customMetrics(): CustomMetric[] {
        return this.config.store.plugin.serverStats.customMetrics || [];
    }

    get defaultMetricsConfig() {
        if (!this.config.store.plugin.serverStats.defaultMetrics) {
            this.config.store.plugin.serverStats.defaultMetrics = { cpu: true, ram: true, disk: true, net: true };
        }
        return this.config.store.plugin.serverStats.defaultMetrics;
    }
    
    async fetchPresets() {
        this.loadingPresets = true;
        this.fetchError = false;
        this.presets = [];

        try {
            const response = await fetch(PRESETS_URL);
            if (!response.ok) throw new Error('Network response was not ok');
            
            const data = await response.json();
            if (Array.isArray(data)) {
                this.presets = data;
            } else {
                throw new Error('Invalid format');
            }
        } catch (e) {
            console.error('Failed to fetch presets:', e);
            this.fetchError = true;
        } finally {
            this.loadingPresets = false;
        }
    }

    addPreset(preset: Partial<CustomMetric>) {
        if (!this.config.store.plugin.serverStats.customMetrics) {
            this.config.store.plugin.serverStats.customMetrics = [];
        }

        const newMetric: CustomMetric = {
            id: Date.now().toString() + Math.random().toString().slice(2, 5),
            label: preset.label || 'New',
            command: preset.command || '',
            type: preset.type || 'text',
            icon: preset.icon,
            color: preset.color || '#00ff00',
            maxValue: preset.maxValue || 100,
            suffix: preset.suffix || '',
            interval: preset.interval,
            colorRules: preset.colorRules ? JSON.parse(JSON.stringify(preset.colorRules)) : []
        };

        this.config.store.plugin.serverStats.customMetrics.push(newMetric);
        this.save();
    }

    editMetric(index: number) {
        this.editingIndex = index;
        this.iconPickerOpen = false;
        this.currentMetric = JSON.parse(JSON.stringify(this.customMetrics[index]));
        if (!this.currentMetric.colorRules) {
            this.currentMetric.colorRules = [];
        }
    }

    cancelEdit() {
        this.editingIndex = -1;
        this.iconPickerOpen = false;
        this.currentMetric = { ...this.defaultMetric, colorRules: [] };
    }

    saveMetric() {
        if ((!this.currentMetric.label && !this.currentMetric.icon) || !this.currentMetric.command) return;

        if (!this.config.store.plugin.serverStats.customMetrics) {
            this.config.store.plugin.serverStats.customMetrics = [];
        }

        const metricToSave: CustomMetric = {
            id: this.currentMetric.id || Date.now().toString(),
            label: this.currentMetric.label ? this.currentMetric.label.trim() : '',
            command: this.currentMetric.command!,
            type: this.currentMetric.type || 'text',
            icon: this.currentMetric.icon ? this.currentMetric.icon.trim() : undefined,
            color: this.currentMetric.color || '#00ff00',
            maxValue: this.currentMetric.maxValue,
            suffix: this.currentMetric.suffix,
            interval: this.currentMetric.interval ? Number(this.currentMetric.interval) : undefined,
            timeout: this.currentMetric.timeout ? Number(this.currentMetric.timeout) : undefined,
            colorRules: this.currentMetric.colorRules && this.currentMetric.colorRules.length > 0 
                ? JSON.parse(JSON.stringify(this.currentMetric.colorRules)) 
                : []
        };

        if (this.editingIndex === -1) {
            this.config.store.plugin.serverStats.customMetrics.push(metricToSave);
        } else {
            this.config.store.plugin.serverStats.customMetrics[this.editingIndex] = metricToSave;
            this.editingIndex = -1;
        }

        this.save();
        this.currentMetric = { ...this.defaultMetric, colorRules: [] };
    }

    removeMetric(index: number) {
        if (confirm('Are you sure you want to delete this metric?')) {
            this.config.store.plugin.serverStats.customMetrics.splice(index, 1);
            this.save();
            if (this.editingIndex === index) {
                this.cancelEdit();
            }
        }
    }

    onDragStart(index: number) { this.draggedIndex = index; }
    onDragOver(event: DragEvent, index: number) { event.preventDefault(); }
    onDrop(targetIndex: number) {
        this.isDragging = false;
        if (this.draggedIndex === null || this.draggedIndex === targetIndex) return;
        const metrics = this.customMetrics;
        const item = metrics[this.draggedIndex];
        metrics.splice(this.draggedIndex, 1);
        metrics.splice(targetIndex, 0, item);
        this.config.store.plugin.serverStats.customMetrics = [...metrics];
        this.save();
        this.draggedIndex = null;
    }
    
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

    openGitHubLink() {
        this.platform.openExternal('https://github.com/kasuganosoras/tabby-server-stats');
    }

    private updateColor(hex: string, opacity: number) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        this.config.store.plugin.serverStats.style.background = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        this.save();
    }

    save() { this.config.save(); }
}

@Injectable()
export class ServerStatsSettingsTabProvider extends SettingsTabProvider {
    constructor(private translate: TranslateService) {
        super();
        setTimeout(() => this.setTitle(this.translate.instant('Server Stats')), 10);
    }

    id = 'server-stats';
    icon = 'fas fa-server'; 
    title = this.translate.instant('Server Stats');

    setTitle(title: string) {
        this.title = title;
    }

    getComponentType(): any { return ServerStatsSettingsComponent; }
}