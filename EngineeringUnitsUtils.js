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

    /**
     * Apply square root scaling for flow measurements
     * @param {number} rawValue - Raw PLC value (typically pressure)
     * @param {object} scaling - Scaling parameters with additional sqrtScaling property
     * @returns {number} - Square root scaled engineering unit value
     */
    static applySqrtScaling(rawValue, scaling) {
        const linearValue = this.rawToEu(rawValue, scaling);
        
        if (linearValue < 0) {
            return 0; // Flow cannot be negative
        }
        
        return Math.sqrt(linearValue / (scaling.euMax || 100)) * (scaling.euMax || 100);
    }

    /**
     * Apply polynomial scaling for non-linear sensors
     * @param {number} rawValue - Raw PLC value
     * @param {object} scaling - Scaling parameters
     * @param {Array} coefficients - Polynomial coefficients [a0, a1, a2, ...] for a0 + a1*x + a2*x^2 + ...
     * @returns {number} - Polynomial scaled engineering unit value
     */
    static applyPolynomialScaling(rawValue, scaling, coefficients) {
        if (!coefficients || coefficients.length === 0) {
            return this.rawToEu(rawValue, scaling);
        }

        // First normalize the raw value to 0-1 range
        const normalizedValue = (rawValue - scaling.rawMin) / (scaling.rawMax - scaling.rawMin);
        
        // Apply polynomial
        let result = 0;
        for (let i = 0; i < coefficients.length; i++) {
            result += coefficients[i] * Math.pow(normalizedValue, i);
        }

        // Scale to engineering units range
        return scaling.euMin + result * (scaling.euMax - scaling.euMin);
    }

    /**
     * Convert temperature between different units
     * @param {number} value - Temperature value
     * @param {string} fromUnit - Source unit ('C', 'F', 'K', 'R')
     * @param {string} toUnit - Target unit ('C', 'F', 'K', 'R')
     * @returns {number} - Converted temperature value
     */
    static convertTemperature(value, fromUnit, toUnit) {
        if (fromUnit === toUnit) return value;

        // Convert to Celsius first
        let celsius;
        switch (fromUnit.toUpperCase()) {
            case 'F':
                celsius = (value - 32) * 5/9;
                break;
            case 'K':
                celsius = value - 273.15;
                break;
            case 'R':
                celsius = (value - 491.67) * 5/9;
                break;
            case 'C':
            default:
                celsius = value;
                break;
        }

        // Convert from Celsius to target unit
        switch (toUnit.toUpperCase()) {
            case 'F':
                return celsius * 9/5 + 32;
            case 'K':
                return celsius + 273.15;
            case 'R':
                return celsius * 9/5 + 491.67;
            case 'C':
            default:
                return celsius;
        }
    }

    /**
     * Convert pressure between different units
     * @param {number} value - Pressure value
     * @param {string} fromUnit - Source unit ('bar', 'psi', 'kPa', 'MPa', 'atm', 'mmHg')
     * @param {string} toUnit - Target unit
     * @returns {number} - Converted pressure value
     */
    static convertPressure(value, fromUnit, toUnit) {
        if (fromUnit === toUnit) return value;

        // Conversion factors to Pascal (Pa)
        const toPA = {
            'bar': 100000,
            'psi': 6894.757,
            'kPa': 1000,
            'kpa': 1000,
            'MPa': 1000000,
            'mpa': 1000000,
            'atm': 101325,
            'mmHg': 133.322,
            'mmhg': 133.322,
            'Pa': 1,
            'pa': 1
        };

        const pascals = value * (toPA[fromUnit] || 1);
        return pascals / (toPA[toUnit] || 1);
    }

    /**
     * Calculate rate of change (derivative) for trending
     * @param {Array} valueHistory - Array of {value, timestamp} objects
     * @param {number} windowSize - Number of points to consider
     * @returns {number} - Rate of change per second
     */
    static calculateRateOfChange(valueHistory, windowSize = 5) {
        if (!valueHistory || valueHistory.length < 2) {
            return 0;
        }

        const dataPoints = valueHistory.slice(-windowSize);
        if (dataPoints.length < 2) {
            return 0;
        }

        const firstPoint = dataPoints[0];
        const lastPoint = dataPoints[dataPoints.length - 1];
        
        const deltaValue = lastPoint.value - firstPoint.value;
        const deltaTime = (new Date(lastPoint.timestamp) - new Date(firstPoint.timestamp)) / 1000; // Convert to seconds

        return deltaTime > 0 ? deltaValue / deltaTime : 0;
    }

    /**
     * Apply hysteresis to reduce oscillation around limits
     * @param {number} currentValue - Current engineering unit value
     * @param {number} previousState - Previous alarm state (0 = normal, 1 = alarm)
     * @param {number} alarmLimit - Alarm threshold
     * @param {number} hysteresis - Hysteresis band (default 2% of limit)
     * @returns {object} - {state: number, triggered: boolean, cleared: boolean}
     */
    static applyHysteresis(currentValue, previousState, alarmLimit, hysteresis = null) {
        if (hysteresis === null) {
            hysteresis = Math.abs(alarmLimit * 0.02); // 2% default hysteresis
        }

        const result = {
            state: previousState,
            triggered: false,
            cleared: false
        };

        if (previousState === 0) {
            // Currently normal, check if alarm should trigger
            if (currentValue > alarmLimit) {
                result.state = 1;
                result.triggered = true;
            }
        } else {
            // Currently in alarm, check if alarm should clear
            if (currentValue < alarmLimit - hysteresis) {
                result.state = 0;
                result.cleared = true;
            }
        }

        return result;
    }

    /**
     * Generate trend data for charting
     * @param {Array} historicalData - Array of data points with timestamp and value
     * @param {number} intervalMinutes - Interval for data aggregation in minutes
     * @returns {Array} - Array of aggregated trend points
     */
    static generateTrendData(historicalData, intervalMinutes = 5) {
        if (!historicalData || historicalData.length === 0) {
            return [];
        }

        const intervalMs = intervalMinutes * 60 * 1000;
        const trendData = [];
        const groupedData = new Map();

        // Group data by time intervals
        historicalData.forEach(point => {
            const timestamp = new Date(point.timestamp);
            const intervalStart = new Date(Math.floor(timestamp.getTime() / intervalMs) * intervalMs);
            const key = intervalStart.getTime();

            if (!groupedData.has(key)) {
                groupedData.set(key, []);
            }
            groupedData.get(key).push(point.value);
        });

        // Calculate statistics for each interval
        groupedData.forEach((values, timestamp) => {
            const stats = this.calculateStatistics(values);
            if (stats) {
                trendData.push({
                    timestamp: new Date(timestamp),
                    min: stats.min,
                    max: stats.max,
                    average: stats.average,
                    count: stats.count
                });
            }
        });

        return trendData.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Detect spikes or anomalies in data
     * @param {Array} values - Array of numerical values
     * @param {number} threshold - Standard deviation multiplier for spike detection
     * @returns {Array} - Array of spike indices
     */
    static detectSpikes(values, threshold = 3) {
        if (!values || values.length < 3) {
            return [];
        }

        const stats = this.calculateStatistics(values);
        if (!stats) {
            return [];
        }

        const spikes = [];
        const upperLimit = stats.average + (threshold * stats.standardDeviation);
        const lowerLimit = stats.average - (threshold * stats.standardDeviation);

        values.forEach((value, index) => {
            if (value > upperLimit || value < lowerLimit) {
                spikes.push({
                    index: index,
                    value: value,
                    deviation: Math.abs(value - stats.average) / stats.standardDeviation
                });
            }
        });

        return spikes;
    }

    /**
     * Calculate process capability indices (Cp, Cpk)
     * @param {Array} values - Array of process values
     * @param {number} lowerSpec - Lower specification limit
     * @param {number} upperSpec - Upper specification limit
     * @returns {object} - Capability indices
     */
    static calculateProcessCapability(values, lowerSpec, upperSpec) {
        const stats = this.calculateStatistics(values);
        if (!stats || upperSpec <= lowerSpec) {
            return null;
        }

        const Cp = (upperSpec - lowerSpec) / (6 * stats.standardDeviation);
        const Cpk = Math.min(
            (stats.average - lowerSpec) / (3 * stats.standardDeviation),
            (upperSpec - stats.average) / (3 * stats.standardDeviation)
        );

        return {
            Cp: Cp,
            Cpk: Cpk,
            processSpread: 6 * stats.standardDeviation,
            specSpread: upperSpec - lowerSpec,
            centeringIndex: Math.abs(stats.average - (upperSpec + lowerSpec) / 2) / ((upperSpec - lowerSpec) / 2)
        };
    }
}

module.exports = EngineeringUnitsUtils;
