const secretKey=/password|secret|authorization|api[_-]?key|access[_-]?token|reasoning|chain[_-]?of[_-]?thought/i;
export function safeText(value:unknown,max=16000):string {
 return String(value??'').replace(/<(?:think|analysis)>[\s\S]*?(?:<\/(?:think|analysis)>|$)/gi,'[private reasoning omitted]')
 .replace(/\b(?:Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,'Bearer [redacted]')
 .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|v1\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|lum_[a-f0-9]{24}\.[a-f0-9]{64})/g,'[credential redacted]')
 .replace(/((?:api[_ -]?key|password|secret|access[_ -]?token)\s*[=:]\s*)(?:\[(?:credential )?redacted\]|"[^"]*"|'[^']*'|[^\s,;}]+)/gi,'$1[redacted]')
 .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email redacted]').slice(0,max);
}
export function sanitize(value:any,depth=0):any {
 if(depth>24)return '[depth limit]';
 if(typeof value==='string')return safeText(value,262144);
 if(Array.isArray(value))return value.slice(0,10000).map(v=>sanitize(v,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['__proto__','prototype','constructor'].includes(k)).map(([k,v])=>[k,secretKey.test(k)?'[redacted]':sanitize(v,depth+1)]));
 return value;
}
