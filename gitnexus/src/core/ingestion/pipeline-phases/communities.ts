/**
 * Phase: communities
 *
 * Detects code communities via Leiden algorithm and creates
 * Community nodes + MEMBER_OF edges.
 *
 * @deps    mro
 * @reads   graph (all nodes and relationships)
 * @writes  graph (Community nodes, MEMBER_OF edges)
 */

import type { PipelinePhase, PipelineContext, PhaseResult } from './types.js';
import { getPhaseOutput } from './types.js';
import type { StructureOutput } from './structure.js';
import { processCommunities, type CommunityDetectionResult } from '../community-processor.js';
import {
  enrichClustersBatch,
  type ClusterEnrichment,
  type ClusterMemberInfo,
} from '../cluster-enricher.js';
import { isDev } from '../utils/env.js';

export interface CommunitiesOutput {
  communityResult: CommunityDetectionResult;
}

const CLUSTER_MEMBER_LABELS = new Set(['Function', 'Class', 'Method', 'Interface']);

function buildClusterMemberMap(
  ctx: PipelineContext,
  communityResult: CommunityDetectionResult,
): Map<string, ClusterMemberInfo[]> {
  const communityIds = new Set(communityResult.communities.map((community) => community.id));
  const memberMap = new Map<string, ClusterMemberInfo[]>();

  for (const membership of communityResult.memberships) {
    if (!communityIds.has(membership.communityId)) continue;

    const node = ctx.graph.getNode(membership.nodeId);
    if (!node || !CLUSTER_MEMBER_LABELS.has(node.label)) continue;

    const members = memberMap.get(membership.communityId) ?? [];
    members.push({
      name: String(node.properties.name ?? ''),
      filePath: String(node.properties.filePath ?? ''),
      type: node.label,
    });
    memberMap.set(membership.communityId, members);
  }

  return memberMap;
}

function isLLMEnrichment(
  enrichment: ClusterEnrichment | undefined,
  fallbackLabel: string,
): enrichment is ClusterEnrichment {
  if (!enrichment) return false;
  return (
    enrichment.name !== fallbackLabel ||
    enrichment.description.length > 0 ||
    enrichment.keywords.length > 0
  );
}

export const communitiesPhase: PipelinePhase<CommunitiesOutput> = {
  name: 'communities',
  deps: ['mro', 'structure'],

  async execute(
    ctx: PipelineContext,
    deps: ReadonlyMap<string, PhaseResult<unknown>>,
  ): Promise<CommunitiesOutput> {
    const { totalFiles } = getPhaseOutput<StructureOutput>(deps, 'structure');

    ctx.onProgress({
      phase: 'communities',
      percent: 84,
      message: 'Detecting code communities...',
      stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: ctx.graph.nodeCount },
    });

    const communityResult = await processCommunities(ctx.graph, (message, progress) => {
      const communityProgress = 84 + progress * 0.09;
      ctx.onProgress({
        phase: 'communities',
        percent: Math.round(communityProgress),
        message,
        stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: ctx.graph.nodeCount },
      });
    });

    if (isDev) {
      console.log(
        `🏘️ Community detection: ${communityResult.stats.totalCommunities} communities found (modularity: ${communityResult.stats.modularity.toFixed(3)})`,
      );
    }

    let enrichments: Map<string, ClusterEnrichment> | undefined;
    const enrichmentOptions = ctx.options?.clusterEnrichment;
    if (enrichmentOptions?.enabled) {
      ctx.onProgress({
        phase: 'communities',
        percent: 93,
        message: 'Enriching community clusters...',
        stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: ctx.graph.nodeCount },
      });

      const memberMap = buildClusterMemberMap(ctx, communityResult);
      const result = await enrichClustersBatch(
        communityResult.communities,
        memberMap,
        enrichmentOptions.llmClient,
        enrichmentOptions.batchSize ?? 5,
        (current, total) => {
          ctx.onProgress({
            phase: 'communities',
            percent: 93,
            message: `Enriching community clusters ${current}/${total}...`,
            stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: ctx.graph.nodeCount },
          });
        },
      );
      enrichments = result.enrichments;
    }

    communityResult.communities.forEach((comm) => {
      const enrichment = enrichments?.get(comm.id);
      const enrichedBy = isLLMEnrichment(enrichment, comm.heuristicLabel) ? 'llm' : 'heuristic';
      ctx.graph.addNode({
        id: comm.id,
        label: 'Community' as const,
        properties: {
          name: enrichment?.name || comm.label,
          filePath: '',
          heuristicLabel: comm.heuristicLabel,
          keywords: enrichment?.keywords ?? [],
          description: enrichment?.description ?? '',
          enrichedBy,
          cohesion: comm.cohesion,
          symbolCount: comm.symbolCount,
        },
      });
    });

    communityResult.memberships.forEach((membership) => {
      ctx.graph.addRelationship({
        id: `${membership.nodeId}_member_of_${membership.communityId}`,
        type: 'MEMBER_OF',
        sourceId: membership.nodeId,
        targetId: membership.communityId,
        confidence: 1.0,
        reason: 'leiden-algorithm',
      });
    });

    return { communityResult };
  },
};
