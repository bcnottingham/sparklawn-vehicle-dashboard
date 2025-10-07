import moment from 'moment-timezone';

export class TimezoneUtils {
    private static readonly SPARKLAWN_TIMEZONE = 'America/Chicago'; // Central Time
    
    /**
     * Convert UTC timestamp to Central Time
     */
    static toCentralTime(utcDate: Date | string): moment.Moment {
        return moment(utcDate).tz(this.SPARKLAWN_TIMEZONE);
    }
    
    /**
     * Get current time in Central Time
     */
    static nowCentral(): moment.Moment {
        return moment().tz(this.SPARKLAWN_TIMEZONE);
    }
    
    /**
     * Format date for display in Central Time
     */
    static formatCentral(utcDate: Date | string, format: string = 'YYYY-MM-DD h:mm:ss A'): string {
        return this.toCentralTime(utcDate).format(format);
    }
    
    /**
     * Get human-readable duration from Central Time
     */
    static getDurationSinceCentral(utcDate: Date | string): string {
        const now = this.nowCentral();
        const then = this.toCentralTime(utcDate);
        const duration = moment.duration(now.diff(then));
        
        const days = Math.floor(duration.asDays());
        const hours = duration.hours();
        const minutes = duration.minutes();
        
        if (days > 0) {
            return `${days}d ${hours}h`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }
    
    /**
     * Check if a UTC timestamp is within business hours (Central Time)
     */
    static isBusinessHours(utcDate: Date | string): boolean {
        const centralTime = this.toCentralTime(utcDate);
        const hour = centralTime.hour();
        const day = centralTime.day(); // 0 = Sunday, 6 = Saturday
        
        // Business hours: Monday-Friday 6 AM - 8 PM Central
        return day >= 1 && day <= 5 && hour >= 6 && hour < 20;
    }
    
    /**
     * Get timezone-aware log message
     */
    static logWithTimezone(message: string): string {
        const centralTime = this.nowCentral().format('MM/DD/YYYY h:mm:ss A');
        return `[${centralTime} CT] ${message}`;
    }
    
    /**
     * Convert duration in milliseconds to human readable format
     */
    static formatDuration(milliseconds: number): string {
        const duration = moment.duration(milliseconds);
        const days = Math.floor(duration.asDays());
        const hours = duration.hours();
        const minutes = duration.minutes();
        
        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m`;
        } else {
            return 'Less than 1m';
        }
    }
}

export default TimezoneUtils;