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

export const GROUP_COLORS: Record<string, string> = {
  EPP: '#3399FF',
  SD: '#FF0000',
  RENEW: '#FFD700',
  GREEN_EFA: '#00AA00',
  ECR: '#0054A5',
  ID: '#2B3856',
  GUE_NGL: '#8B0000',
  NI: '#999999',
  PFE: '#704214',
  ESN: '#8B4513',
}

export const GROUP_NAMES: Record<string, string> = {
  EPP: "European People's Party",
  SD: 'Socialists & Democrats',
  RENEW: 'Renew Europe',
  GREEN_EFA: 'Greens/EFA',
  ECR: 'European Conservatives',
  ID: 'Identity and Democracy',
  GUE_NGL: 'The Left',
  NI: 'Non-Inscrits',
  PFE: 'Patriots for Europe',
  ESN: 'Europe of Sovereign Nations',
}

export const COUNTRY_NAMES: Record<string, string> = {
  AUT: 'Austria',
  BEL: 'Belgium',
  BGR: 'Bulgaria',
  HRV: 'Croatia',
  CYP: 'Cyprus',
  CZE: 'Czechia',
  DNK: 'Denmark',
  EST: 'Estonia',
  FIN: 'Finland',
  FRA: 'France',
  DEU: 'Germany',
  GRC: 'Greece',
  HUN: 'Hungary',
  IRL: 'Ireland',
  ITA: 'Italy',
  LVA: 'Latvia',
  LTU: 'Lithuania',
  LUX: 'Luxembourg',
  MLT: 'Malta',
  NLD: 'Netherlands',
  POL: 'Poland',
  PRT: 'Portugal',
  ROU: 'Romania',
  SVK: 'Slovakia',
  SVN: 'Slovenia',
  ESP: 'Spain',
  SWE: 'Sweden',
}

export const COUNTRY_COLORS: Record<string, string> = {
  AUT: '#ED2939',
  BEL: '#FDDA24',
  BGR: '#00966E',
  HRV: '#171796',
  CYP: '#D57800',
  CZE: '#11457E',
  DNK: '#C8102E',
  EST: '#0072CE',
  FIN: '#003580',
  FRA: '#0055A4',
  DEU: '#FFCC00',
  GRC: '#0D5EAF',
  HUN: '#436F4D',
  IRL: '#169B62',
  ITA: '#008C45',
  LVA: '#9E3039',
  LTU: '#006A44',
  LUX: '#00A1DE',
  MLT: '#CF142B',
  NLD: '#FF6600',
  POL: '#DC143C',
  PRT: '#006600',
  ROU: '#002B7F',
  SVK: '#0B4EA2',
  SVN: '#005DA4',
  ESP: '#AA151B',
  SWE: '#006AA7',
}

// Left to right ideological order
export const GROUP_ORDER = [
  'GUE_NGL', // Far Left
  'GREEN_EFA', // Left / Green
  'SD', // Center-Left
  'RENEW', // Center / Liberal
  'EPP', // Center-Right
  'ECR', // Right
  'ID', // Far Right (EP9)
  'PFE', // Far Right (EP10)
  'ESN', // Far Right (EP10)
  'NI', // Non-attached
]
