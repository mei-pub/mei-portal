import { corsHeaders } from './_shared/cors'

interface Env {
  [key: string]: string
}

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { headers: corsHeaders })
}

export const onRequestGet: PagesFunction<Env> = async () => {
  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
