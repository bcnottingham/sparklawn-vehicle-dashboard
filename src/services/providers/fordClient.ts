import { fordTelematicsClient } from '../fordTelematicsClient';

export interface FordSignal {
    ts: string;  // chosen best timestamp
    position?: { lat: number; lon: number; ts?: string };
    ignition?: { value: 'On' | 'Off' | 'Run' | 'Unknown'; ts?: string };
    odoMiles?: { value: number; ts?: string };
    socPct?: { value: number; ts?: string };
    rangeKm?: { value: number; ts?: string };
    plug?: { connected: boolean; ts?: string };
}

export class FordClient {
    /**
     * Stable wrapper for Ford API that normalizes response format changes
     * Handles signals[] array vs object, timestamp selection, unit consistency
     */
    async getSignals(vin: string, signalFilter: string[]): Promise<FordSignal> {
        try {
            const raw = await fordTelematicsClient.instance.getVehicleStatus(vin, signalFilter);

            // Ford changed signals from object to array - normalize this
            const signals = Array.isArray(raw?.signals) && raw.signals.length > 0 ? raw.signals[0] : raw?.signals || {};

            // Extract and normalize individual signals
            const position = this.extractPosition(signals);
            const ignition = this.extractIgnition(signals);
            const odoMiles = this.extractOdometer(signals);
            const socPct = this.extractBatterySOC(signals);
            const rangeKm = this.extractBatteryRange(signals);
            const plug = this.extractPlugStatus(signals);

            // Choose best timestamp from available signals
            const ts = this.chooseBestTimestamp([
                ignition?.ts,
                position?.ts,
                odoMiles?.ts,
                socPct?.ts,
                rangeKm?.ts,
                plug?.ts
            ]);

            return {
                ts,
                position,
                ignition,
                odoMiles,
                socPct,
                rangeKm,
                plug
            };

        } catch (error) {
            console.error(`❌ Ford API error for ${vin}:`, error);
            throw error;
        }
    }

    private extractPosition(signals: any): { lat: number; lon: number; ts?: string } | undefined {
        const pos = signals.position?.value;
        if (pos?.latitude != null && pos?.longitude != null) {
            return {
                lat: Number(pos.latitude),
                lon: Number(pos.longitude),
                ts: signals.position?.timestamp
            };
        }
        return undefined;
    }

    private extractIgnition(signals: any): { value: 'On' | 'Off' | 'Run' | 'Unknown'; ts?: string } | undefined {
        const ignitionValue = signals.ignition_status?.value;
        if (ignitionValue != null) {
            // Normalize ignition status to our enum
            let normalized: 'On' | 'Off' | 'Run' | 'Unknown' = 'Unknown';
            const val = String(ignitionValue).toLowerCase();

            if (['on', 'run', 'running', 'started'].includes(val)) {
                normalized = val === 'run' || val === 'running' ? 'Run' : 'On';
            } else if (['off', 'stopped'].includes(val)) {
                normalized = 'Off';
            }

            return {
                value: normalized,
                ts: signals.ignition_status?.timestamp
            };
        }
        return undefined;
    }

    private extractOdometer(signals: any): { value: number; ts?: string } | undefined {
        const odo = signals.odometer?.value;
        if (odo != null && !isNaN(Number(odo))) {
            // Ford API returns odometer in kilometers, convert to miles
            const odoKm = Number(odo);
            const odoMiles = odoKm / 1.609344;
            return {
                value: Math.round(odoMiles),
                ts: signals.odometer?.timestamp
            };
        }
        return undefined;
    }

    private extractBatterySOC(signals: any): { value: number; ts?: string } | undefined {
        const soc = signals.xev_battery_state_of_charge?.value;
        if (soc != null && !isNaN(Number(soc))) {
            return {
                value: Number(soc),
                ts: signals.xev_battery_state_of_charge?.timestamp
            };
        }
        return undefined;
    }

    private extractBatteryRange(signals: any): { value: number; ts?: string } | undefined {
        const range = signals.xev_battery_range?.value;
        if (range != null && !isNaN(Number(range))) {
            return {
                value: Number(range), // Keep in km as received
                ts: signals.xev_battery_range?.timestamp
            };
        }
        return undefined;
    }

    private extractPlugStatus(signals: any): { connected: boolean; ts?: string } | undefined {
        const plugStatus = signals.xev_plug_charger_status?.value;
        if (plugStatus != null) {
            return {
                connected: String(plugStatus).toLowerCase() === 'connected',
                ts: signals.xev_plug_charger_status?.timestamp
            };
        }
        return undefined;
    }

    private chooseBestTimestamp(timestamps: (string | undefined)[]): string {
        // Find the newest timestamp among available signals
        const validTimestamps = timestamps.filter(ts => ts != null) as string[];

        if (validTimestamps.length === 0) {
            return new Date().toISOString();
        }

        // Sort to find newest
        validTimestamps.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
        return validTimestamps[0];
    }
}

export const fordClient = new FordClient();