import {DEFAULT_MODEL,FEATURE_DEFAULT_MODELS} from '../../../lib/models.mjs';
export async function GET(){return Response.json({defaultModel:DEFAULT_MODEL,featureDefaults:FEATURE_DEFAULT_MODELS},{headers:{'Cache-Control':'no-store'}})}
