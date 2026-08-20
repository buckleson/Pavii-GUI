import { ipcBridge } from '@/common';
import useSWR from 'swr';

// Gemini model ordering: Pro first, then version descending
const sortGeminiModels = (models: { label: string; value: string }[]) => {
  return models.toSorted((a, b) => {
    const aPro = a.value.toLowerCase().includes('pro');
    const bPro = b.value.toLowerCase().includes('pro');

    // Pro models come first
    if (aPro && !bPro) return -1;
    if (!aPro && bPro) return 1;

    // Extract version numbers to compare
    const extractVersion = (name: string) => {
      const match = name.match(/(\d+\.?\d*)/);
      return match ? parseFloat(match[1]) : 0;
    };

    const aVersion = extractVersion(a.value);
    const bVersion = extractVersion(b.value);

    // Higher versions come first
    if (aVersion !== bVersion) {
      return bVersion - aVersion;
    }

    // Equal versions fall back to alphabetical order
    return a.value.localeCompare(b.value);
  });
};

const useModeModeList = (
  platform: string,
  base_url?: string,
  api_key?: string,
  try_fix?: boolean,
  bedrock_config?: {
    auth_method: 'accessKey' | 'profile';
    region: string;
    access_key_id?: string;
    secret_access_key?: string;
    profile?: string;
  }
) => {
  return useSWR(
    [platform + '/models', { platform, base_url, api_key, try_fix, bedrock_config }],
    async ([_url, { platform, base_url, api_key, try_fix, bedrock_config }]): Promise<{
      models: { label: string; value: string }[];
      fix_base_url?: string;
    }> => {
      // Only call the backend when we have credentials it can actually use:
      // - bedrock: bedrock_config carries the credentials (api_key not required)
      // - everything else: api_key is mandatory per backend validator
      const hasUsableCredentials = platform === 'bedrock' ? !!bedrock_config : !!api_key;
      if (hasUsableCredentials) {
        const res = await ipcBridge.mode.fetchModelList.invoke({
          base_url,
          api_key: api_key ?? '',
          try_fix,
          platform,
          bedrock_config,
        });
        let modelList = res.models.map((v) => {
          // Handle both string and object formats (Bedrock returns objects with id and name)
          if (typeof v === 'string') {
            return { label: v, value: v };
          } else {
            return { label: v.name, value: v.id };
          }
        });

        // Apply the tuned ordering on Gemini platforms
        if (platform?.includes('gemini')) {
          modelList = sortGeminiModels(modelList);
        }

        // Include the corrected base_url in the result when one is returned
        if (res.fixed_base_url) {
          return {
            models: modelList,
            fix_base_url: res.fixed_base_url,
          };
        }

        return { models: modelList };
      }

      // With no API key, base_url or bedrock_config, return an empty list
      return { models: [] };
    }
  );
};

export default useModeModeList;
