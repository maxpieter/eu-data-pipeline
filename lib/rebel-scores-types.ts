export interface MEPData {
  'member.id': number
  first_name: string
  last_name: string
  group: string
  country: string
  n_votes: number
  avg_rebel_score: number
  avg_country_rebel_score: number
  group_z_score: number
  country_z_score: number
  group_is_outlier: boolean
  country_is_outlier: boolean
}

export interface MEPDataResponse {
  meps: MEPData[]
  meta: {
    total_votes: number
    total_meps: number
  }
}

export interface ConfigTopic {
  [name: string]: string // topic name -> slug
}

export interface ConfigPeriod {
  id: string
  label: string
  start: string
  end: string
  is_default: boolean
}

export interface Config {
  topics: ConfigTopic
  periods: ConfigPeriod[]
  default_period: string
}

export type ViewMode = 'group' | 'country'

// Re-export color/label constants from the shared module
export {
  GROUP_COLORS,
  GROUP_NAMES,
  COUNTRY_COLORS,
  COUNTRY_NAMES,
  GROUP_ORDER,
} from '@/lib/constants'
