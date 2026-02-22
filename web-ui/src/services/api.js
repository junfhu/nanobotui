/**
 * API service for nanobot web interface.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

class ApiService {
  /**
   * Send a chat message to nanobot
   * @param {string} message - The message to send
   * @param {string} sessionId - The session ID
   * @returns {Promise<Object>} The response from nanobot
   */
  async chat(message, sessionId = 'web:default') {
    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, session_id: sessionId }),
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Chat API error:', error);
      return {
        message,
        response: `Error sending message: ${error.message}`,
        session_id: sessionId,
        note: 'API error occurred'
      };
    }
  }

  /**
   * Get nanobot status
   * @returns {Promise<Object>} The status information
   */
  async getStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/status`);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Status API error:', error);
      return {
        status: 'error',
        mode: 'offline',
        services: {
          chat: 'unavailable',
          config: 'unavailable',
          status: 'unavailable'
        },
        error: error.message
      };
    }
  }

  /**
   * Get nanobot config
   * @returns {Promise<Object>} The config information
   */
  async getConfig() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/config`);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Config API error:', error);
      return {
        agents: {
          defaults: {
            model: 'unknown',
            temperature: 0.7,
            max_tokens: 4096
          }
        },
        gateway: {
          host: 'localhost',
          port: 8000
        },
        error: error.message
      };
    }
  }

  /**
   * Check API health
   * @returns {Promise<Object>} Health information
   */
  async healthCheck() {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Health check error:', error);
      return {
        status: 'error',
        nanobot_available: false,
        mode: 'offline',
        error: error.message
      };
    }
  }

  /**
   * Save nanobot config
   * @param {Object} config - The config object to save
   * @returns {Promise<Object>} The response from the API
   */
  async saveConfig(config) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Save config API error:', error);
      return {
        status: 'error',
        message: `Error saving config: ${error.message}`
      };
    }
  }
}

export default new ApiService();
