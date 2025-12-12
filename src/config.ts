import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'

export interface CustomMetric {
    id: string
    label: string
    command: string
    type: 'progress' | 'text'
    color?: string
    suffix?: string
    maxValue?: number
}

@Injectable()
export class ServerStatsConfigProvider extends ConfigProvider {
    defaults = {
        plugin: {
            serverStats: {
                enabled: true,
                displayMode: 'bottomBar',
                location: { x: null, y: null },
                style: {
                    background: 'rgba(20, 20, 20, 0.90)',
                    size: 100,
                    layout: 'vertical'
                },
                customMetrics: [] as CustomMetric[] 
            }
        }
    }
}