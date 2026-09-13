import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { CustomMetric } from '../config'
import { exec } from 'child_process'
import { Subject } from 'rxjs'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const LOG_FILE = path.join(os.tmpdir(), 'tabby-server-stats.log');
let logCounter = 0;
function logDebug(msg: string) {
    if (!StatsService.isDebugEnabled) {
        return;
    }
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try {
        logCounter++;
        if (logCounter % 100 === 0) {
            try {
                const stat = fs.statSync(LOG_FILE);
                if (stat.size > 2 * 1024 * 1024) {
                    fs.writeFileSync(LOG_FILE, `[${new Date().toISOString()}] [log rotated]\n`);
                }
            } catch {}
        }
        fs.appendFileSync(LOG_FILE, line);
    } catch {}
    console.log(`[ServerStats] ${msg}`);
}

interface MetricState {
    lastAttempt: number
    lastSuccess: number
    value: string
    isFetching: boolean
}

interface SessionCache {
    lastBaseFetch: number
    baseStats: { cpu: number; mem: number; disk: number; netRx: number; netTx: number }
    metricStates: Map<string, MetricState>
}

@Injectable({ providedIn: 'root' })
export class StatsService {
    public static isDebugEnabled = false;
    private baseStatsCommand = `export LC_ALL=C; PATH=$PATH:/usr/bin:/bin:/usr/sbin:/sbin; OS=$(uname -s 2>/dev/null || echo "Linux"); if [ "$OS" = "Darwin" ]; then cpu=$(ps -A -o %cpu | awk '{s+=$1} END {print s}' 2>/dev/null || echo "0"); mem=$(ps -A -o %mem | awk '{s+=$1} END {print s}' 2>/dev/null || echo "0"); disk=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' | sed 's/%//' || echo "0"); echo "TABBY-STATS-START $cpu 0 0 $mem $disk"; else stats=$( (grep 'cpu ' /proc/stat; awk 'NR>2 {r+=$2; t+=$10} END{print r, t}' /proc/net/dev; sleep 1; grep 'cpu ' /proc/stat; awk 'NR>2 {r+=$2; t+=$10} END{print r, t}' /proc/net/dev) 2>/dev/null | awk 'NR==1 {t1=$2+$3+$4+$5+$6+$7+$8; i1=$5} NR==2 {rx1=$1; tx1=$2} NR==3 {t2=$2+$3+$4+$5+$6+$7+$8; i2=$5} NR==4 {rx2=$1; tx2=$2} END { dt=t2-t1; di=i2-i1; cpu=(dt<=0)?0:(dt-di)/dt*100; rx=rx2-rx1; tx=tx2-tx1; printf "%.1f %.0f %.0f", cpu, rx, tx }' ); mem=$(free 2>/dev/null | awk 'NR==2{printf "%.2f", $3*100/$2 }'); disk=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' | sed 's/%//'); if [ -z "$stats" ]; then stats="0 0 0"; fi; if [ -z "$mem" ]; then mem="0"; fi; if [ -z "$disk" ]; then disk="0"; fi; echo "TABBY-STATS-START $stats $mem $disk"; fi`
    private serverCaches = new Map<string, SessionCache>();
    private fetchGuards = new Map<string, boolean>();
    public statsUpdated$ = new Subject<{ serverKey: string; stats: any }>();

    constructor(private config: ConfigService) {
        this.updateDebugState();
        this.config.changed$.subscribe(() => this.updateDebugState());
        this.config.ready$.subscribe(() => this.updateDebugState());
    }

    private updateDebugState() {
        StatsService.isDebugEnabled = Boolean(this.config?.store?.plugin?.serverStats?.debugLogging);
    }

    public getServerKey(session: any): string {
        if (!session) return 'default';
        if (session.profile) {
            if (session.profile.id) return `profile:${session.profile.id}`;
            if (session.profile.options?.host) {
                return `host:${session.profile.options.user || ''}@${session.profile.options.host}:${session.profile.options.port || 22}`;
            }
            if (session.profile.name) return `name:${session.profile.name}`;
        }
        if (session.ssh?.ssh?.config?.host) {
            return `ssh:${session.ssh.ssh.config.user || ''}@${session.ssh.ssh.config.host}:${session.ssh.ssh.config.port || 22}`;
        }
        if (session.savedTitle) return `title:${session.savedTitle}`;
        return `session:${session.id || 'default'}`;
    }

    private getSessionCache(session: any): SessionCache {
        const key = this.getServerKey(session);
        let cache = this.serverCaches.get(key);
        if (!cache) {
            cache = {
                lastBaseFetch: 0,
                baseStats: { cpu: 0, mem: 0, disk: 0, netRx: 0, netTx: 0 },
                metricStates: new Map<string, MetricState>()
            };
            this.serverCaches.set(key, cache);
        }
        return cache;
    }

    getCachedStats(session: any): any | null {
        if (!session) return null;
        const key = this.getServerKey(session);
        const cache = this.serverCaches.get(key);
        if (!cache || (cache.lastBaseFetch === 0 && cache.metricStates.size === 0)) return null;
        const conf = this.config?.store?.plugin?.serverStats || {};
        const customMetrics: CustomMetric[] = conf.customMetrics || [];
        return {
            ...cache.baseStats,
            custom: customMetrics.map(m => ({
                id: m.id,
                value: cache.metricStates.get(m.id)?.value ?? '-'
            }))
        };
    }

    isPlatformSupport(session: any): boolean {
        if (!session || session.open === false) {
            return false;
        }
        const sshClient = session.ssh && session.ssh.ssh ? session.ssh.ssh : null;
        const isSSH = sshClient && typeof sshClient.openSessionChannel === 'function';
        return isSSH || process.platform === 'linux' || process.platform === 'darwin';
    }

    async fetchStats(session: any): Promise<any | null> {
        if (!session || session.open === false) return null;

        const serverKey = this.getServerKey(session);
        const cache = this.getSessionCache(session);
        const now = Date.now();
        const conf = this.config?.store?.plugin?.serverStats || {};
        const defaultInterval = Math.max(1, conf.defaultInterval || 3);
        const defaultMetrics = conf.defaultMetrics || { cpu: true, ram: true, disk: true, net: true };
        const isAnyDefaultMetricEnabled = Boolean(defaultMetrics.cpu || defaultMetrics.ram || defaultMetrics.disk || defaultMetrics.net);
        const customMetrics: CustomMetric[] = conf.customMetrics || [];

        // If another request is currently running for this server, return current stats immediately
        if (this.fetchGuards.get(serverKey)) {
            return {
                ...cache.baseStats,
                custom: customMetrics.map(m => ({
                    id: m.id,
                    value: cache.metricStates.get(m.id)?.value ?? '-'
                }))
            };
        }

        const sshClient = session.ssh && session.ssh.ssh ? session.ssh.ssh : null;
        const isSSH = sshClient && typeof sshClient.openSessionChannel === 'function';
        const isLocalSupported = !isSSH && (process.platform === 'linux' || process.platform === 'darwin');

        if (!isSSH && !isLocalSupported) {
            return null;
        }

        // Check if base stats need updating
        const isBaseDue = isAnyDefaultMetricEnabled && (now - cache.lastBaseFetch >= defaultInterval * 1000);

        // Check which custom metrics are due
        const dueCustomMetrics: CustomMetric[] = [];
        for (const m of customMetrics) {
            let state = cache.metricStates.get(m.id);
            if (!state) {
                state = { lastAttempt: 0, lastSuccess: 0, value: '-', isFetching: false };
                cache.metricStates.set(m.id, state);
            }
            if (state.isFetching) {
                continue;
            }

            const mInterval = (m.interval && m.interval > 0 ? m.interval : defaultInterval) * 1000;
            // Always respect the configured metric interval, even if the metric is currently in error,
            // preventing servers from being flooded with failing commands every 5s.
            const effectiveInterval = mInterval;
            if (state.lastAttempt === 0 || (now - state.lastAttempt >= effectiveInterval)) {
                dueCustomMetrics.push(m);
            }
        }

        // If neither base nor any custom metric is due, return cached data without firing SSH command
        if (!isBaseDue && dueCustomMetrics.length === 0) {
            return {
                ...cache.baseStats,
                custom: customMetrics.map(m => ({
                    id: m.id,
                    value: cache.metricStates.get(m.id)?.value ?? '-'
                }))
            };
        }

        this.fetchGuards.set(serverKey, true);

        // Mark executing metrics
        if (isBaseDue) {
            cache.lastBaseFetch = now;
        }
        for (const m of dueCustomMetrics) {
            const s = cache.metricStates.get(m.id);
            if (s) {
                s.isFetching = true;
                s.lastAttempt = now;
            }
        }

        logDebug(`[fetchStats] Server: ${serverKey}, baseDue=${isBaseDue}, dueMetrics=[${dueCustomMetrics.map(m => m.label || m.id).join(', ')}]`);

        const emitCurrentStats = () => {
            this.statsUpdated$.next({
                serverKey,
                stats: {
                    ...cache.baseStats,
                    custom: customMetrics.map(m => ({
                        id: m.id,
                        value: cache.metricStates.get(m.id)?.value ?? '-'
                    }))
                }
            });
        };

        const onStreamingBuffer = (currentBuffer: string) => {
            let updated = false;

            if (isBaseDue) {
                const match = currentBuffer.match(/TABBY-STATS-START\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)/);
                if (match && match.length >= 6) {
                    const newBase = {
                        cpu: parseFloat(match[1]) || 0,
                        netRx: parseFloat(match[2]) || 0,
                        netTx: parseFloat(match[3]) || 0,
                        mem: parseFloat(match[4]) || 0,
                        disk: parseFloat(match[5]) || 0
                    };
                    if (cache.baseStats.disk !== newBase.disk || cache.baseStats.cpu !== newBase.cpu || cache.baseStats.mem !== newBase.mem) {
                        cache.baseStats = newBase;
                        cache.lastBaseFetch = Date.now();
                        updated = true;
                    }
                }
            }

            for (const m of dueCustomMetrics) {
                const safeId = m.id.replace(/[^a-zA-Z0-9_-]/g, '');
                const startTag = `TABBY-CUSTOM-START:${safeId}`;
                const endTag = `TABBY-CUSTOM-END:${safeId}`;

                if (currentBuffer.includes(startTag) && currentBuffer.includes(endTag)) {
                    const rawVal = currentBuffer.split(startTag)[1].split(endTag)[0];
                    const cleanVal = rawVal.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim();

                    // If output has multiple lines (e.g. warnings before value), take the last non-empty line
                    const lines = cleanVal.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                    const parsedVal = lines.length > 0 ? lines[lines.length - 1] : cleanVal;

                    const state = cache.metricStates.get(m.id);
                    if (state) {
                        state.isFetching = false;
                        state.lastAttempt = Date.now();

                        if (parsedVal !== undefined && parsedVal !== '') {
                            if (parsedVal.startsWith('Err:')) {
                                logDebug(`[metric:error] Server: ${serverKey}, ${m.label || m.id}: ${parsedVal}`);
                                state.value = parsedVal;
                            } else {
                                state.lastSuccess = Date.now();
                                if (state.value !== parsedVal) {
                                    logDebug(`[metric:update] Server: ${serverKey}, ${m.label || m.id} -> ${parsedVal}`);
                                    state.value = parsedVal;
                                    updated = true;
                                }
                            }
                        } else {
                            // Empty output with 0 exit code
                            logDebug(`[metric:empty] Server: ${serverKey}, ${m.label || m.id} produced empty output`);
                            state.lastSuccess = Date.now();
                            state.value = '0';
                            updated = true;
                        }
                    }
                }
            }

            if (updated) {
                emitCurrentStats();
            }
        };

        const formatMetricCmd = (m: CustomMetric) => {
            const safeId = m.id.replace(/[^a-zA-Z0-9_-]/g, '');
            const mTimeout = Math.max(1, m.timeout || 15);
            return (
                `(\n` +
                `_out=$(\n` +
                `if command -v timeout >/dev/null 2>&1; then\n` +
                `timeout --kill-after=2s ${mTimeout}s /bin/sh <<'EOF_TABBY_${safeId}'\n` +
                `${m.command}\n` +
                `EOF_TABBY_${safeId}\n` +
                `else\n` +
                `/bin/sh <<'EOF_TABBY_${safeId}'\n` +
                `${m.command}\n` +
                `EOF_TABBY_${safeId}\n` +
                `fi 2>&1\n` +
                `)\n` +
                `_code=$?\n` +
                `if [ $_code -eq 124 ]; then\n` +
                `printf 'TABBY-CUSTOM-START:${safeId}\\nErr: Timeout\\nTABBY-CUSTOM-END:${safeId}\\n'\n` +
                `elif [ $_code -eq 0 ]; then\n` +
                `printf 'TABBY-CUSTOM-START:${safeId}\\n%s\\nTABBY-CUSTOM-END:${safeId}\\n' "$_out"\n` +
                `else\n` +
                `_msg=$(echo "$_out" | tr '\\r\\n' '  ' | cut -c 1-60)\n` +
                `printf 'TABBY-CUSTOM-START:${safeId}\\nErr: %s\\nTABBY-CUSTOM-END:${safeId}\\n' "\${_msg:-error}"\n` +
                `fi\n` +
                `) &`
            );
        };

        try {
            const parts: string[] = ['export LC_ALL=C PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"'];

            // Run all custom metrics concurrently in parallel subshells so lightweight commands
            // are never delayed by slower commands, regardless of what commands the user defines.
            for (const m of dueCustomMetrics) {
                parts.push(formatMetricCmd(m));
            }

            // Base stats (which contains sleep 1 for CPU diff) also runs concurrently in background
            if (isBaseDue) {
                parts.push(`(\n${this.baseStatsCommand}\n) &`);
            }

            parts.push('wait');
            parts.push('echo " TABBY-STATS-END"');
            const finalCommand = parts.join('\n') + '\n';

            let output: string | null = null;
            let totalTimeoutSec = 20;
            for (const m of dueCustomMetrics) {
                totalTimeoutSec += Math.max(1, m.timeout || 30);
            }
            const execTimeoutMs = Math.max(45000, totalTimeoutSec * 1000);

            if (isSSH) {
                output = await this.exec(sshClient, finalCommand, execTimeoutMs, onStreamingBuffer);
            } else if (isLocalSupported) {
                output = await this.execLocal(finalCommand, execTimeoutMs);
            }

            if (output) {
                onStreamingBuffer(output);
            }
            emitCurrentStats();

            logDebug(`[fetchStats:done] Server: ${serverKey}, summary: ` + 
                customMetrics.map(m => `${m.label || m.id}=${cache.metricStates.get(m.id)?.value ?? '-'}`).join(' | '));

            return {
                ...cache.baseStats,
                custom: customMetrics.map(m => ({
                    id: m.id,
                    value: cache.metricStates.get(m.id)?.value ?? '-'
                }))
            };

        } catch (e: any) {
            logDebug(`[fetchStats:error] Server: ${serverKey}, error: ${e?.message || e}`);
            for (const m of dueCustomMetrics) {
                const state = cache.metricStates.get(m.id);
                if (state) {
                    state.isFetching = false;
                    state.lastAttempt = now;
                    // Do not erase existing valid numbers on temporary SSH drop
                    if (!state.value || state.value === '-') {
                        state.value = e && e.message && e.message.includes('Timeout') ? 'Err: Timeout' : '-';
                    }
                }
            }
            return {
                ...cache.baseStats,
                custom: customMetrics.map(m => ({
                    id: m.id,
                    value: cache.metricStates.get(m.id)?.value ?? '-'
                }))
            };
        } finally {
            for (const m of dueCustomMetrics) {
                const s = cache.metricStates.get(m.id);
                if (s) s.isFetching = false;
            }
            this.fetchGuards.delete(serverKey);
        }
    }

    private execLocal(cmd: string, timeoutMs: number = 45000): Promise<string> {
        return new Promise((resolve) => {
            exec(cmd, { timeout: timeoutMs }, (error, stdout) => {
                if (error) {
                    logDebug(`[execLocal:error] ${error.message}`);
                    resolve('');
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    private async exec(sshClient: any, cmd: string, timeoutMs: number = 45000, onChunk?: (buffer: string) => void): Promise<string> {
        const startTime = Date.now();
        logDebug(`[exec:start] timeout=${timeoutMs}ms, cmdLength=${cmd.length}`);

        let timeoutTimer: any = null;
        const timeout = new Promise<never>((_, reject) => {
            timeoutTimer = setTimeout(() => {
                logDebug(`[exec:timeout] Reached ${timeoutMs}ms limit`);
                reject(new Error('Stats: Timeout'));
            }, timeoutMs);
        });

        const run = async () => {
            let channel: any = null;
            try {
                const newChannel = await sshClient.openSessionChannel();
                channel = await sshClient.activateChannel(newChannel);
                logDebug(`[exec:channel] Activated channel`);
            } catch (err: any) {
                logDebug(`[exec:channel:error] ${err?.message || err}`);
                throw err;
            }

            return new Promise<string>((resolve, reject) => {
                let buffer = '';
                let stderrBuffer = '';
                let resolved = false;
                const subs: any[] = [];
                const decoder = new TextDecoder('utf-8');

                const cleanup = () => {
                    subs.forEach(s => {
                        try { s.unsubscribe(); } catch(e){}
                    });
                    if (channel) {
                        try { channel.close(); } catch(e){}
                    }
                };

                const finish = (reason: string) => {
                    if (resolved) return;
                    resolved = true;
                    const elapsed = Date.now() - startTime;
                    logDebug(`[exec:finish] Reason=${reason}, duration=${elapsed}ms, stdoutLen=${buffer.length}, stderrLen=${stderrBuffer.length}`);
                    cleanup();
                    resolve(buffer);
                };

                const processData = (chunk: any) => {
                    let text = '';
                    if (typeof chunk === 'string') {
                        text = chunk;
                    } else if (Buffer.isBuffer(chunk)) {
                        text = chunk.toString('utf8');
                    } else if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
                        text = decoder.decode(chunk, { stream: true });
                    } else {
                        text = String(chunk);
                    }

                    buffer += text;

                    if (onChunk) {
                        try {
                            onChunk(buffer);
                        } catch (err) {
                            logDebug(`[exec:onChunk:error] ${err}`);
                        }
                    }

                    if (!resolved && buffer.includes('TABBY-STATS-END')) {
                        finish('end_tag');
                    }
                };

                // STDOUT
                if (channel.data$) {
                    subs.push(channel.data$.subscribe({
                        next: (data: any) => processData(data),
                        error: (err: any) => {
                            logDebug(`[exec:data$:error] ${err}`);
                            if (!resolved) {
                                cleanup();
                                reject(err);
                            }
                        },
                        complete: () => {
                            logDebug(`[exec:data$:complete]`);
                            setTimeout(() => finish('data_complete'), 100);
                        }
                    }));
                } else {
                    cleanup();
                    reject(new Error('Channel has no data$ observable'));
                    return;
                }

                // STDERR
                if (channel.extendedData$) {
                    subs.push(channel.extendedData$.subscribe({
                        next: (data: any) => {
                            let text = '';
                            if (typeof data === 'string') text = data;
                            else if (Buffer.isBuffer(data)) text = data.toString('utf8');
                            else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) text = decoder.decode(data, { stream: true });
                            else text = String(data);
                            stderrBuffer += text;
                            logDebug(`[exec:stderr] ${text.trim()}`);
                        },
                        error: (err: any) => logDebug(`[exec:extendedData$:error] ${err}`)
                    }));
                }

                // EOF / CLOSED events
                if (channel.eof$) {
                    subs.push(channel.eof$.subscribe(() => {
                        logDebug(`[exec:eof$] Remote sent EOF (awaiting buffer processing/channel close)`);
                    }));
                }
                if (channel.closed$) {
                    subs.push(channel.closed$.subscribe(() => {
                        logDebug(`[exec:closed$] Remote channel closed`);
                        setTimeout(() => finish('closed'), 100);
                    }));
                }

                if (typeof channel.requestExec === 'function') {
                    channel.requestExec(cmd).catch((err: any) => {
                        logDebug(`[exec:requestExec:error] ${err?.message || err}`);
                        cleanup();
                        reject(err);
                    });
                } else if (typeof channel.exec === 'function') {
                    channel.exec(cmd).catch((err: any) => {
                        logDebug(`[exec:exec:error] ${err?.message || err}`);
                        cleanup();
                        reject(err);
                    });
                } else {
                    cleanup();
                    reject(new Error('Channel has no requestExec or exec method'));
                }
            });
        };

        try {
            return await Promise.race([run(), timeout]);
        } finally {
            if (timeoutTimer) {
                clearTimeout(timeoutTimer);
            }
        }
    }
}
