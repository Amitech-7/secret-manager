import { createApiClient } from '@sm/client'

export const api = createApiClient({ baseUrl: import.meta.env.VITE_API_URL ?? '' })
