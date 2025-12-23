import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { CustomMetric } from '../config'
import { exec } from 'child_process'

@Injectable({ providedIn: 'root' })
export class StatsService {
    // 修复：支持 Linux 和 macOS，增强了错误处理和环境兼容性
    // Thanks: https://blog.csdn.net/weixin_41635157/article/details/156060209?spm=1011.2415.3001.5331
    private baseStatsCommand = `export LC_ALL=C; PATH=$PATH:/usr/bin:/bin:/usr/sbin:/sbin; OS=$(uname -s 2>/dev/null || echo "Linux"); if [ "$OS" = "Darwin" ]; then cpu=$(ps -A -o %cpu | awk '{s+=$1} END {print s}' 2>/dev/null || echo "0"); mem=$(ps -A -o %mem | awk '{s+=$1} END {print s}' 2>/dev/null || echo "0"); disk=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' | sed 's/%//' || echo "0"); echo "TABBY-STATS-START $cpu 0 0 $mem $disk"; else stats=$( (grep 'cpu ' /proc/stat; awk 'NR>2 {r+=$2; t+=$10} END{print r, t}' /proc/net/dev; sleep 1; grep 'cpu ' /proc/stat; awk 'NR>2 {r+=$2; t+=$10} END{print r, t}' /proc/net/dev) 2>/dev/null | awk 'NR==1 {t1=$2+$3+$4+$5+$6+$7+$8; i1=$5} NR==2 {rx1=$1; tx1=$2} NR==3 {t2=$2+$3+$4+$5+$6+$7+$8; i2=$5} NR==4 {rx2=$1; tx2=$2} END { dt=t2-t1; di=i2-i1; cpu=(dt<=0)?0:(dt-di)/dt*100; rx=rx2-rx1; tx=tx2-tx1; printf "%.1f %.0f %.0f", cpu, rx, tx }' ); mem=$(free 2>/dev/null | awk 'NR==2{printf "%.2f", $3*100/$2 }'); disk=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' | sed 's/%//'); if [ -z "$stats" ]; then stats="0 0 0"; fi; if [ -z "$mem" ]; then mem="0"; fi; if [ -z "$disk" ]; then disk="0"; fi; echo "TABBY-STATS-START $stats $mem $disk"; fi`
    private isFetching = false;

    constructor(private config: ConfigService) {}

    async fetchStats(session: any): Promise<any | null> {
        if (!session || this.isFetching) return null;
        this.isFetching = true;
        
        try {
            const sshClient = session.ssh && session.ssh.ssh ? session.ssh.ssh : null;
            const isSSH = sshClient && typeof sshClient.openSessionChannel === 'function';
            const isLocalSupported = !isSSH && (process.platform === 'linux' || process.platform === 'darwin');

            if (!isSSH && !isLocalSupported) {
                this.isFetching = false;
                return null;
            }

            const customMetrics: CustomMetric[] = this.config.store.plugin.serverStats.customMetrics || [];
            
            let finalCommand = this.baseStatsCommand;
            
            if (customMetrics.length > 0) {
                finalCommand += '; echo "TABBY-STATS-CUSTOM-START"; ';
                const customCmds = customMetrics.map(m => `( ${m.command} ) || echo "Err"`).join('; echo "TABBY-STATS-NEXT"; ');
                finalCommand += customCmds;
            }

            finalCommand += '; echo " TABBY-STATS-END"';
            finalCommand = finalCommand.replace(/\n/g, ' ');
            finalCommand = `/bin/sh -c '${finalCommand.replace(/'/g, "'\\''")}'`;

            let output: string | null = null;

            if (isSSH) {
                output = await this.exec(sshClient, finalCommand);
            } else if (isLocalSupported) {
                output = await this.execLocal(finalCommand);
            }

            if (!output) {
                this.isFetching = false;
                return null;
            }

            const result: any = {};
            const match = output.match(/TABBY-STATS-START\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)/);

            if (match && match.length >= 6) {
                result.cpu = parseFloat(match[1]) || 0;
                result.netRx = parseFloat(match[2]) || 0;
                result.netTx = parseFloat(match[3]) || 0;
                result.mem = parseFloat(match[4]) || 0;
                result.disk = parseFloat(match[5]) || 0;
            }

            if (customMetrics.length > 0 && output.includes('TABBY-STATS-CUSTOM-START')) {
                const customPart = output.split('TABBY-STATS-CUSTOM-START')[1].split('TABBY-STATS-END')[0];
                const customValues = customPart.split('TABBY-STATS-NEXT').map(s => s.trim());
                
                result.custom = customMetrics.map((m, index) => ({
                    id: m.id,
                    value: customValues[index] || '-'
                }));
            }

            this.isFetching = false;
            return result;

        } catch (e) {
            // console.error('Stats: Fetch Error:', e);
            this.isFetching = false;
        }
        
        return null;
    }

    private execLocal(cmd: string): Promise<string> {
        return new Promise((resolve) => {
            exec(cmd, { timeout: 5000 }, (error, stdout) => {
                if (error) {
                    // console.error('Stats: Local Exec Error', error);
                    resolve('');
                } else {
                    resolve(stdout);
                }
            });
        });
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