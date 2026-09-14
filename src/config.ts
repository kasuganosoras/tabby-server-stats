import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'

export type ConditionOperator = '>=' | '>' | '<=' | '<' | '==' | '!=' | 'contains' | 'not_contains' | 'starts_with' | 'regex';

export interface ColorCondition {
    operator: ConditionOperator
    value: string
    color: string
}

export interface CustomMetric {
    id: string
    label?: string
    command: string
    type: 'progress' | 'text'
    icon?: string
    color?: string
    suffix?: string
    maxValue?: number
    interval?: number
    timeout?: number
    colorRules?: ColorCondition[]
}

export { 
    getSvgPresetPath, 
    isSvgPreset, 
    isUrlOrDataUri, 
    isFaIcon, 
    formatFontAwesomeIcon, 
    TECH_ICON_PATHS,
    POPULAR_ICON_PRESETS,
    DEFAULT_METRIC_ICONS
} from './icons/presets';

export interface DefaultMetricsConfig {
    cpu: boolean
    ram: boolean
    disk: boolean
    net: boolean
}

export function evaluateColor(value: any, rules?: ColorCondition[], defaultColor: string = '#2ecc71'): string {
    if (!rules || rules.length === 0) {
        return defaultColor;
    }

    const rawStr = value !== undefined && value !== null ? String(value).trim() : '';
    const numMatch = rawStr.match(/-?\d+(?:\.\d+)?/);
    const numVal = numMatch ? parseFloat(numMatch[0]) : NaN;
    const isNum = !isNaN(numVal) && isFinite(numVal);

    for (const rule of rules) {
        if (!rule || !rule.color) continue;
        const ruleVal = rule.value !== undefined && rule.value !== null ? String(rule.value).trim() : '';
        const ruleNumMatch = ruleVal.match(/-?\d+(?:\.\d+)?/);
        const ruleNum = ruleNumMatch ? parseFloat(ruleNumMatch[0]) : NaN;
        const ruleIsNum = !isNaN(ruleNum) && isFinite(ruleNum);

        let matched = false;

        switch (rule.operator) {
            case '>=':
                if (isNum && ruleIsNum) matched = numVal >= ruleNum;
                break;
            case '>':
                if (isNum && ruleIsNum) matched = numVal > ruleNum;
                break;
            case '<=':
                if (isNum && ruleIsNum) matched = numVal <= ruleNum;
                break;
            case '<':
                if (isNum && ruleIsNum) matched = numVal < ruleNum;
                break;
            case '==':
                if (isNum && ruleIsNum && rawStr === String(numVal) && ruleVal === String(ruleNum)) {
                    matched = numVal === ruleNum;
                } else {
                    matched = rawStr.toLowerCase() === ruleVal.toLowerCase();
                }
                break;
            case '!=':
                if (isNum && ruleIsNum && rawStr === String(numVal) && ruleVal === String(ruleNum)) {
                    matched = numVal !== ruleNum;
                } else {
                    matched = rawStr.toLowerCase() !== ruleVal.toLowerCase();
                }
                break;
            case 'contains':
                matched = rawStr.toLowerCase().includes(ruleVal.toLowerCase());
                break;
            case 'not_contains':
                matched = !rawStr.toLowerCase().includes(ruleVal.toLowerCase());
                break;
            case 'starts_with':
                matched = rawStr.toLowerCase().startsWith(ruleVal.toLowerCase());
                break;
            case 'regex':
                try {
                    const re = new RegExp(ruleVal, 'i');
                    matched = re.test(rawStr);
                } catch {
                    matched = false;
                }
                break;
        }

        if (matched) {
            return rule.color;
        }
    }

    return defaultColor;
}

@Injectable()
export class ServerStatsConfigProvider extends ConfigProvider {
    defaults = {
        plugin: {
            serverStats: {
                enabled: true,
                displayMode: 'bottomBar',
                defaultInterval: 3,
                debugLogging: false,
                location: { x: null, y: null },
                style: {
                    background: 'rgba(20, 20, 20, 0.90)',
                    size: 100,
                    layout: 'vertical'
                },
                defaultMetrics: {
                    cpu: true,
                    ram: true,
                    disk: true,
                    net: true
                },
                showDefaultIcons: true,
                customMetrics: [] as CustomMetric[] 
            }
        }
    }
}