import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useAnalyses() {
  return useQuery({
    queryKey: ['analyses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('analyses')
        .select('*, analysis_tags(tag_id, is_primary, tags(id, name, category))')
        .order('sort_order')
      if (error) throw error
      return data
    },
  })
}

export function useAnalysis(id) {
  return useQuery({
    queryKey: ['analysis', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('analyses')
        .select('*, analysis_tags(tag_id, is_primary, tags(id, name, category))')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

/** Extract flat tag ID array from an analysis row */
export function getAnalysisTagIds(analysis) {
  if (!analysis?.analysis_tags) return []
  return analysis.analysis_tags.map((at) => at.tag_id).filter(Boolean)
}

/** Extract flat tag display-name array from an analysis row */
export function getAnalysisTagNames(analysis) {
  if (!analysis?.analysis_tags) return []
  return analysis.analysis_tags.map((at) => at.tags?.name).filter(Boolean)
}

/** Check if a dataset (from datasets_with_tags view) supports an analysis */
export function datasetSupportsAnalysis(dataset, analysis) {
  const requiredTagIds = getAnalysisTagIds(analysis)
  const availableTagIds = dataset.tag_ids || []
  return requiredTagIds.every((t) => availableTagIds.includes(t))
}
