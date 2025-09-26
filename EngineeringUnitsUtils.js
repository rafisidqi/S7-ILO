/**
 * Engineering Units Utilities
 * Provides scaling functions for converting between raw PLC values and engineering units
 */

class EngineeringUnitsUtils {
    /**
     * Convert raw PLC value to engineering units
     * Linear scaling: EU = EuMin + (Raw - RawMin) * (EuMax - EuMin) / (RawMax - RawMin)
     * 
     * @param {number} rawValue - Raw value from PLC
     * @param {object} scaling - Scaling parameters {rawMin, rawMax, euMin, euMax}
     * @returns {number} - Engineering unit value
     */
    static rawToEu(rawValue, scaling) {
        const { rawMin = 0, rawMax = 32767, euMin = 0, euMax = 100 } = scaling;
        
        // Handle edge cases
        if (rawValue === null || rawValue === undefined || isNaN(rawValue)) {
            return null;
        }
        
        // Prevent division by zero
        if (rawMax === rawMin) {
            return euMin;
        }
        
        // Linear scaling calculation
        const euValue = euMin + (rawValue - rawMin) * (euMax - euMin) / (rawMax - rawMin);
        
        return euValue;
    }

    /**
     * Convert engineering units value to raw PLC value
     * Inverse linear scaling: Raw = RawMin + (EU - EuMin) * (RawMax - RawMin) / (EuMax - EuMin)
     * 
     * @param {number} euValue - Engineering unit value
     * @param {object} scaling - Scaling parameters {rawMin, rawMax, euMin, euMax}
     * @returns {number} - Raw PLC value
     */
    static euToRaw(euValue, scaling) {
        const { rawMin = 0, rawMax = 32767, euMin = 0, euMax = 100 } = scaling;
        
        // Handle edge cases
        if (euValue === null || euValue === undefined || isNaN(euValue)) {
            return null;
        }
        
        // Prevent division by zero
        if (euMax === euMin) {
            return rawMin;
        }
        
        // Inverse linear scaling calculation
        const rawValue = rawMin + (euValue - euMin) * (rawMax - rawMin) / (euMax - euMin);
        
        return rawValue;
    }

    /**
     * Validate scaling parameters
     * @param {object} scaling - Scaling parameters to validate
     * @returns {object} - {valid: boolean, errors: string[]}
     */
    static validateScaling(scaling) {
        const errors = [];
        const { rawMin, rawMax, euMin, euMax } = scaling;

        if (rawMin === undefined || rawMin === null || isNaN(rawMin)) {
            errors.push('RawMin must be a valid number');
        }

        if (rawMax === undefined || rawMax === null || isNaN(rawMax)) {
            errors.push('RawMax must be a valid number');
        }

        if (euMin === undefined || euMin === null || isNaN(euMin)) {
            errors.push('EuMin must be a valid number');
        }

        if (euMax === undefined || euMax === null || isNaN(euMax)) {
            errors.push('EuMax must be a valid number');
        }

        if (rawMin >= rawMax) {
            errors.push('RawMax must be greater than RawMin');
        }

        if (euMin >= euMax) {
            errors.push('EuMax must be greater than EuMin');
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Apply precision formatting to a value
     * @param {number} value - Value to format
     * @param {number} decimalPlaces - Number of decimal places
     * @param {string} formatString - Optional custom format string
     * @returns {string} - Formatted value
     */
    static formatValue(value, decimalPlaces = 2, formatString = null) {
        if (value === null || value === undefined || isNaN(value)) {
            return 'N/A';
        }

        if (formatString) {
            // Handle custom format strings (basic implementation)
            try {
                return formatString.replace('{0}', value.toFixed(decimalPlaces));
            } catch (error) {
                // Fall back to default formatting if custom format fails
            /**
     * Apply precision formatting to a value
     * @param {number} value - Value to format
     * @param {number} decimalPlaces - Number of decimal places
     * @param {string} formatString - Optional custom format string
     * @returns {string} - Formatted value
     */
    static formatValue(value, decimalPlaces = 2, formatString = null) {
        if (value === null || value === undefined || isNaN(value)) {
            return 'N/A';
        }

        if (formatString) {
            // Handle custom format strings (basic implementation)
            try {
                return formatString.replace('{0}', value.toFixed(decimalPlaces));
            } catch (error) {
                // Fall back to default formatting if custom format fails
                return value.toFixed(decimalPlaces);
            }
        }

        return value.toFixed(decimalPlaces);
    }

    /**
     * Create a complete engineering units object for a tag
     * @param {number} rawValue - Raw PLC value
     * @param {object} tagMetadata - Tag metadata with scaling parameters
     * @returns {object} - Complete engineering units object
     */
    static createEuObject(rawValue, tagMetadata) {
        if (!tagMetadata) {
            return {
                rawValue: rawValue,
                euValue: rawValue,
                formattedValue: this.formatValue(rawValue),
                units: '',
                scaling: null,
                quality: 'UNKNOWN'
            };
        }

        const scaling = {
            rawMin: tagMetadata.rawMin || 0,
            rawMax: tagMetadata.rawMax || 32767,
            euMin: tagMetadata.euMin || 0,
            euMax: tagMetadata.euMax || 100
        };

        const euValue = this.rawToEu(rawValue, scaling);
        const decimalPlaces = tagMetadata.decimalPlaces || 2;
        const units = tagMetadata.engineeringUnits || tagMetadata.units || '';
        const formatString = tagMetadata.formatString;

        return {
            rawValue: rawValue,
            euValue: euValue,
            formattedValue: this.formatValue(euValue, decimalPlaces, formatString),
            units: units,
            scaling: scaling,
            quality: 'GOOD',
            metadata: {
                decimalPlaces: decimalPlaces,
                formatString: formatString,
                description: tagMetadata.description,
                group: tagMetadata.group
            }
        };
    }

    /**
     * Check if a value is within operating limits (in engineering units)
     * @param {number} euValue - Engineering unit value
     * @param {object} tagMetadata - Tag metadata with limit parameters
     * @returns {object} - Limit check result
     */
    static checkLimits(euValue, tagMetadata) {
        const result = {
            value: euValue,
            withinLimits: true,
            violations: [],
            alarms: []
        };

        if (!tagMetadata || euValue === null || euValue === undefined) {
            return result;
        }

        // Check operating limits
        if (tagMetadata.minValue !== null && euValue < tagMetadata.minValue) {
            result.withinLimits = false;
            result.violations.push({
                type: 'MIN_OPERATING',
                value: euValue,
                limit: tagMetadata.minValue,
                message: `Value ${euValue} below minimum operating limit ${tagMetadata.minValue}`
            });
        }

        if (tagMetadata.maxValue !== null && euValue > tagMetadata.maxValue) {
            result.withinLimits = false;
            result.violations.push({
                type: 'MAX_OPERATING',
                value: euValue,
                limit: tagMetadata.maxValue,
                message: `Value ${euValue} above maximum operating limit ${tagMetadata.maxValue}`
            });
        }

        // Check alarm limits
        if (tagMetadata.alarmHigh !== null && euValue > tagMetadata.alarmHigh) {
            result.alarms.push({
                type: 'HIGH',
                value: euValue,
                limit: tagMetadata.alarmHigh,
                severity: 'WARNING',
                message: `High alarm: ${euValue} > ${tagMetadata.alarmHigh}`
            });
        }

        if (tagMetadata.alarmLow !== null && euValue < tagMetadata.alarmLow) {
            result.alarms.push({
                type: 'LOW',
                value: euValue,
                limit: tagMetadata.alarmLow,
                severity: 'WARNING',
                message: `Low alarm: ${euValue} < ${tagMetadata.alarmLow}`
            });
        }

        return result;
    }

    /**
     * Calculate statistical values for engineering units data
     * @param {Array} euValues - Array of engineering unit values
     * @returns {object} - Statistical summary
     */
    static calculateStatistics(euValues) {
        if (!euValues || euValues.length === 0) {
            return null;
        }

        const validValues = euValues.filter(v => v !== null && v !== undefined && !isNaN(v));
        
        if (validValues.length === 0) {
            return null;
        }

        const min = Math.min(...validValues);
        const max = Math.max(...validValues);
        const sum = validValues.reduce((a, b) => a + b, 0);
        const avg = sum / validValues.length;
        
        // Calculate standard deviation
        const variance = validValues.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / validValues.length;
        const stdDev = Math.sqrt(variance);

        return {
            count: validValues.length,
            min: min,
            max: max,
            average: avg,
            sum: sum,
            standardDeviation: stdDev,
            range: max - min
        };
    }

    /**
     * Create scaling parameters for common sensor types
     * @param {string} sensorType - Type of sensor
     * @param {object} options - Additional options for scaling
     * @returns {object} - Scaling parameters
     */
    static createStandardScaling(sensorType, options = {}) {
        const presets = {
            'temperature_4_20ma': {
                rawMin: 0,
                rawMax: 32767,
                euMin: options.tempMin || -20,
                euMax: options.tempMax || 150,
                engineeringUnits: '°C',
                decimalPlaces: 1
            },
            'pressure_4_20ma': {
                rawMin: 0,
                rawMax: 32767,
                euMin: 0,
                euMax: options.pressureMax || 10,
                engineeringUnits: 'bar',
                decimalPlaces: 2
            },
            'level_4_20ma': {
                rawMin: 0,
                rawMax: 32767,
                euMin: 0,
                euMax: 100,
                engineeringUnits: '%',
                decimalPlaces: 1
            },
            'flow_4_20ma': {
                rawMin: 0,
                rawMax: 32767,
                euMin: 0,
                euMax: options.flowMax || 1000,
                engineeringUnits: 'L/min',
                decimalPlaces: 1
            },
            'speed_analog': {
                rawMin: 0,
                rawMax: 32767,
                euMin: 0,
                euMax: options.speedMax || 3000,
                engineeringUnits: 'RPM',
                decimalPlaces: 0
            },
            'percentage': {
                rawMin: 0,
                rawMax: 32767,
                euMin: 0,
                euMax: 100,
                engineeringUnits: '%',
                decimalPlaces: 1
            },
            'current_4_20ma': {
                rawMin: 0,
                rawMax: 32767,
                euMin: 4,
                euMax: 20,
                engineeringUnits: 'mA',
                decimalPlaces: 2
            },
            'voltage_0_10v': {
                rawMin: 0,
                rawMax: 32767,
                euMin: 0,
                euMax: 10,
                engineeringUnits: 'V',
                decimalPlaces: 3
            },
            'boolean': {
                rawMin: 0,
                rawMax: 1,
                euMin: 0,
                euMax: 1,
                engineeringUnits: 'bool',
                decimalPlaces: 0
            }
        };

        return presets[sensorType] || {
            rawMin: 0,
            rawMax: 32767,
            euMin: 0,
            euMax: 100,
            engineeringUnits: '',
            decimalPlaces: 2
        };
    }

    /**
     * Interpolate between two scaling points for non-linear scaling
     * @param {number} rawValue - Raw PLC value
     * @param {Array} scalingPoints - Array of {raw, eu} points
     * @returns {number} - Interpolated engineering unit value
     */
    static interpolateScaling(rawValue, scalingPoints) {
        if (!scalingPoints || scalingPoints.length === 0) {
            return rawValue;
        }

        // Sort scaling points by raw value
        const sortedPoints = scalingPoints.sort((a, b) => a.raw - b.raw);

        // If raw value is below the first point, use first point scaling
        if (rawValue <= sortedPoints[0].raw) {
            return sortedPoints[0].eu;
        }

        // If raw value is above the last point, use last point scaling
        if (rawValue >= sortedPoints[sortedPoints.length - 1].raw) {
            return sortedPoints[sortedPoints.length - 1].eu;
        }

        // Find the two points to interpolate between
        for (let i = 0; i < sortedPoints.length - 1; i++) {
            const point1 = sortedPoints[i];
            const point2 = sortedPoints[i + 1];

            if (rawValue >= point1.raw && rawValue <= point2.raw) {
                // Linear interpolation between the two points
                const ratio = (rawValue - point1.raw) / (point2.raw - point1.raw);
                return point1.eu + ratio * (point2.eu - point1.eu);
            }
        }

        // Fallback (shouldn't reach here)
        return rawValue;
    }

    /**
     * Validate engineering unit value against raw limits
     * @param {number} euValue - Engineering unit value to validate
     * @param {object} scaling - Scaling parameters
     * @returns {object} - Validation result
     */
    static validateEuValue(euValue, scaling) {
        const result = {
            valid: true,
            clampedValue: euValue,
            warnings: []
        };

        if (!scaling || euValue === null || euValue === undefined) {
            return result;
        }

        const { euMin, euMax } = scaling;

        if (euValue < euMin) {
            result.valid = false;
            result.clampedValue = euMin;
            result.warnings.push(`Value ${euValue} clamped to minimum ${euMin}`);
        }

        if (euValue > euMax) {
            result.valid = false;
            result.clampedValue = euMax;
            result.warnings.push(`Value ${euValue} clamped to maximum ${euMax}`);
        }

        return result;
    }

    /**
     * Create a tag metadata object with proper engineering units
     * @param {object} config - Tag configuration
     * @returns {object} - Complete tag metadata
     */
    static createTagMetadata(config) {
        const {
            name,
            address,
            type = 'REAL',
            description = '',
            group = 'Default',
            rawMin = 0,
            rawMax = 32767,
            euMin = 0,
            euMax = 100,
            engineeringUnits = '',
            decimalPlaces = 2,
            formatString = null,
            minValue = null,
            maxValue = null,
            alarmHigh = null,
            alarmLow = null
        } = config;

        return {
            name,
            addr: address,
            type,
            description,
            group,
            rawMin,
            rawMax,
            euMin,
            euMax,
            engineeringUnits,
            decimalPlaces,
            formatString,
            limits: {
                min: minValue,
                max: maxValue,
                alarmHigh,
                alarmLow
            },
            scaling: {
                rawMin,
                rawMax,
                euMin,
                euMax
            }
        };
    }
}

module.exports = EngineeringUnitsUtils;
            }
        }

        return value.toFixed(decimalPlaces);
