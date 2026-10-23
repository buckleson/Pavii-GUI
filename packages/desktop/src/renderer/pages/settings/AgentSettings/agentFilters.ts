import { OPEN_SOURCE_CLIS } from '@/common/types/agent/openSourceClis';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

export type AgentAvailabilityFilter = 'all' | 'available' | 'unavailable' | 'openSource';

const isAgentAvailable = (agent: ManagedAgent): boolean => agent.status === 'online';

/** Position of the agent's backend in OPEN_SOURCE_CLIS, or -1 when it is not open source. */
const openSourceRank = (agent: ManagedAgent): number =>
  agent.backend ? OPEN_SOURCE_CLIS.findIndex((cli) => cli.backend === agent.backend) : -1;

/** Open-source agents in OPEN_SOURCE_CLIS (star) order; the sort is stable for rows sharing a backend. */
export const filterOpenSourceAgents = (agents: ManagedAgent[]): ManagedAgent[] =>
  agents
    .filter((agent) => openSourceRank(agent) >= 0)
    .toSorted((left, right) => openSourceRank(left) - openSourceRank(right));

export const getAgentAvailabilityFilterStats = (agents: ManagedAgent[]) => ({
  all: agents.length,
  available: agents.filter(isAgentAvailable).length,
  unavailable: agents.filter((agent) => !isAgentAvailable(agent)).length,
  openSource: agents.filter((agent) => openSourceRank(agent) >= 0).length,
});

export const filterAgentsByAvailability = (agents: ManagedAgent[], filter: AgentAvailabilityFilter): ManagedAgent[] => {
  if (filter === 'available') {
    return agents.filter(isAgentAvailable);
  }
  if (filter === 'unavailable') {
    return agents.filter((agent) => !isAgentAvailable(agent));
  }
  if (filter === 'openSource') {
    return filterOpenSourceAgents(agents);
  }
  return agents;
};
