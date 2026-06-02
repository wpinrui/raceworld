import {
  fakerEN_GB, fakerDE, fakerFR, fakerIT, fakerES,
  fakerPT_BR, fakerNL, fakerFI, fakerEN_AU,
  fakerEN_CA, fakerEN_US, fakerCS_CZ, fakerPL,
} from '@faker-js/faker'

// ISO country code for each locale entry (parallel array)
export const FAKER_LOCALE_CODES = [
  'GB', 'GB', 'GB',
  'DE', 'DE',
  'FR', 'FR',
  'IT',
  'ES',
  'BR', 'BR',
  'NL',
  'FI',
  'AU',
  'CA',
  'US', 'US',
  'CZ',
  'PL',
]

// Latin-alphabet locales only, weighted by F1 grid representation
export const FAKER_LOCALES = [
  fakerEN_GB, fakerEN_GB, fakerEN_GB,
  fakerDE, fakerDE,
  fakerFR, fakerFR,
  fakerIT,
  fakerES,
  fakerPT_BR, fakerPT_BR,
  fakerNL,
  fakerFI,
  fakerEN_AU,
  fakerEN_CA,
  fakerEN_US, fakerEN_US,
  fakerCS_CZ,
  fakerPL,
]
