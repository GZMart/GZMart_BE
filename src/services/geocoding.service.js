import axios from "axios";

/**
 * Geocoding Service
 * Converts Vietnamese address to GPS coordinates (latitude, longitude)
 * Using Google Maps Geocoding API
 */

class GeocodingService {
  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
    this.baseUrl = "https://maps.googleapis.com/maps/api/geocode/json";
  }

  /**
   * Build full address string from components
   * @param {Object} addressComponents - Address parts
   * @returns {String} - Full formatted address
   */
  buildFullAddress(addressComponents) {
    const { street, details, wardName, districtName, provinceName } =
      addressComponents;

    const parts = [];

    if (details) parts.push(details);
    if (street) parts.push(street);
    if (wardName) parts.push(wardName);
    if (districtName) parts.push(districtName);
    if (provinceName) parts.push(provinceName);
    parts.push("Vietnam"); // Always add country for better accuracy

    return parts.filter(Boolean).join(", ");
  }

  /**
   * Geocode address to GPS coordinates using Google Maps API
   * @param {Object} addressComponents - Address parts (street, wardName, districtName, provinceName, details)
   * @returns {Promise<Object|null>} - { lat: Number, lng: Number, formattedAddress: String } or null
   */
  async geocodeAddress(addressComponents) {
    try {
      // If API key not configured, skip geocoding
      if (!this.apiKey || this.apiKey === "your_google_maps_api_key_here") {
        console.warn(
          "[Geocoding] Google Maps API key not configured. Skipping geocoding.",
        );
        return null;
      }

      const fullAddress = this.buildFullAddress(addressComponents);

      // Call Google Maps Geocoding API
      const response = await axios.get(this.baseUrl, {
        params: {
          address: fullAddress,
          key: this.apiKey,
          language: "vi", // Vietnamese language for results
          region: "vn", // Vietnam region bias
        },
        timeout: 5000, // 5 second timeout
      });

      const data = response.data;

      // Check if geocoding was successful
      if (data.status !== "OK" || !data.results || data.results.length === 0) {
        console.warn(
          `[Geocoding] Failed to geocode address: ${fullAddress}. Status: ${data.status}`,
        );
        return null;
      }

      const result = data.results[0];
      const location = result.geometry.location;

      return {
        lat: location.lat,
        lng: location.lng,
        formattedAddress: result.formatted_address,
      };
    } catch (error) {
      console.error("[Geocoding] Error geocoding address:", error.message);
      // Don't throw error - geocoding is optional
      return null;
    }
  }

  /**
   * Reverse geocode: Convert GPS coordinates to address
   * @param {Number} lat - Latitude
   * @param {Number} lng - Longitude
   * @returns {Promise<Object|null>} - Address components or null
   */
  async reverseGeocode(lat, lng) {
    try {
      if (!this.apiKey || this.apiKey === "your_google_maps_api_key_here") {
        console.warn(
          "[Geocoding] Google Maps API key not configured. Skipping reverse geocoding.",
        );
        return null;
      }

      const response = await axios.get(this.baseUrl, {
        params: {
          latlng: `${lat},${lng}`,
          key: this.apiKey,
          language: "vi",
          region: "vn",
        },
        timeout: 5000,
      });

      const data = response.data;

      if (data.status !== "OK" || !data.results || data.results.length === 0) {
        console.warn(
          `[Geocoding] Failed to reverse geocode (${lat}, ${lng}). Status: ${data.status}`,
        );
        return null;
      }

      const result = data.results[0];

      // Parse address components
      const addressComponents = result.address_components;
      const parsed = {
        formattedAddress: result.formatted_address,
        street: "",
        ward: "",
        district: "",
        province: "",
        country: "",
      };

      addressComponents.forEach((component) => {
        const types = component.types;

        if (types.includes("route")) {
          parsed.street = component.long_name;
        } else if (
          types.includes("sublocality_level_1") ||
          types.includes("administrative_area_level_3")
        ) {
          parsed.ward = component.long_name;
        } else if (types.includes("administrative_area_level_2")) {
          parsed.district = component.long_name;
        } else if (types.includes("administrative_area_level_1")) {
          parsed.province = component.long_name;
        } else if (types.includes("country")) {
          parsed.country = component.long_name;
        }
      });

      return parsed;
    } catch (error) {
      console.error(
        "[Geocoding] Error reverse geocoding coordinates:",
        error.message,
      );
      return null;
    }
  }

  /**
   * Calculate distance between two GPS points (Haversine formula)
   * @param {Number} lat1 - Latitude of point 1
   * @param {Number} lng1 - Longitude of point 1
   * @param {Number} lat2 - Latitude of point 2
   * @param {Number} lng2 - Longitude of point 2
   * @returns {Number} - Distance in kilometers
   */
  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Radius of Earth in kilometers
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lng2 - lng1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return Math.round(distance * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Convert degrees to radians
   * @param {Number} deg - Degrees
   * @returns {Number} - Radians
   */
  toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  /**
   * Validate GPS coordinates
   * @param {Number} lat - Latitude
   * @param {Number} lng - Longitude
   * @returns {Boolean} - True if valid
   */
  isValidCoordinates(lat, lng) {
    return (
      typeof lat === "number" &&
      typeof lng === "number" &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    );
  }
}

// Export singleton instance
export default new GeocodingService();
