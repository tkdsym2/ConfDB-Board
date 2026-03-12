import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useDatasets() {
  return useQuery({
    queryKey: ['datasets_with_tags'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('datasets_with_tags')
        .select('*')
      if (error) throw error
      return data
    },
  })
}

export function useTagCounts() {
  return useQuery({
    queryKey: ['tag_counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tag_counts')
        .select('*')
      if (error) throw error
      return data
    },
  })
}

export function useDataset(id) {
  return useQuery({
    queryKey: ['dataset', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('datasets')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

export function useDatasetWithTags(id) {
  return useQuery({
    queryKey: ['dataset_with_tags', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('datasets_with_tags')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

export function useDatasetTags(id) {
  return useQuery({
    queryKey: ['dataset_tags', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dataset_tags')
        .select('tag_id, note, tags(id, name, category, sort_order)')
        .eq('dataset_id', id)
      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}
