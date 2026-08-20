/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * API Provider Host Configuration
 *
 * Centralized management of official API hostnames for AI providers
 */
export const API_HOST_CONFIG = {
  /**
   * Google AI Official Hosts
   */
  google: {
    /** Gemini API (generativelanguage.googleapis.com) */
    gemini: 'generativelanguage.googleapis.com',
    /** Vertex AI (aiplatform.googleapis.com) */
    vertexAi: 'aiplatform.googleapis.com',
  },

  /**
   * OpenAI Official Hosts
   */
  openai: {
    api: 'api.openai.com',
  },

  /**
   * Anthropic Official Hosts
   */
  anthropic: {
    api: 'api.anthropic.com',
  },
} as const;

/**
 * Google API Hosts Whitelist (derived from config)
 */
export const GOOGLE_API_HOSTS = Object.values(API_HOST_CONFIG.google);

/**
 * Safely validate if URL is an official host for specified provider
 *
 * @param urlString URL string to validate
 * @param allowedHosts List of allowed hostnames
 * @returns Returns true if valid official host
 */
export function isOfficialHost(urlString: string, allowedHosts: readonly string[]): boolean {
  try {
    const url = new URL(urlString);
    return allowedHosts.includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Safely validate if URL is a Google APIs host
 *
 * Uses URL parsing instead of string includes to prevent malicious URL bypass
 *
 * @param urlString URL string to validate
 * @returns Returns true if valid Google APIs host
 *
 * @example
 * isGoogleApisHost('https://generativelanguage.googleapis.com/v1') // true
 * isGoogleApisHost('https://evil.com/generativelanguage.googleapis.com') // false
 * isGoogleApisHost('https://generativelanguage.googleapis.com.evil.com') // false
 */
export function isGoogleApisHost(urlString: string): boolean {
  return isOfficialHost(urlString, GOOGLE_API_HOSTS);
}

/**
 * Validate if URL is an official OpenAI host
 */
export function isOpenAIHost(urlString: string): boolean {
  return isOfficialHost(urlString, Object.values(API_HOST_CONFIG.openai));
}

/**
 * Validate if URL is an official Anthropic host
 */
export function isAnthropicHost(urlString: string): boolean {
  return isOfficialHost(urlString, Object.values(API_HOST_CONFIG.anthropic));
}
