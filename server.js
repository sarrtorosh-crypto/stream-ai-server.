'use strict';
// Minimal same-origin server and secure OpenAI API proxy. Requires Node.js 18+.
// Keep OPENAI_API_KEY in the server environment; never put it into index.html.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 8;
const calls = new Map();
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
function send(res, status, body, headers={}) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}); res.end(JSON.stringify(body)); }
function readBody(req, max=20_000) { return new Promise((resolve,reject)=>{let body='';req.on('data',chunk=>{body+=chunk;if(body.length>max){reject(new Error('Запрос слишком большой'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(body||'{}'));}catch{reject(new Error('Неверный JSON'));}});req.on('error',reject);}); }
function allowed(ip){const now=Date.now();const arr=(calls.get(ip)||[]).filter(t=>now-t<WINDOW_MS);if(arr.length>=MAX_REQUESTS){calls.set(ip,arr);return false;}arr.push(now);calls.set(ip,arr);return true;}
function getText(data){if(typeof data.output_text==='string')return data.output_text.trim();return (data.output||[]).flatMap(item=>item.content||[]).filter(c=>c.type==='output_text'&&typeof c.text==='string').map(c=>c.text).join('\n').trim();}
const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if(req.method==='GET' && url.pathname==='/health') return send(res,200,{ok:true,aiConfigured:Boolean(process.env.OPENAI_API_KEY),model:MODEL});
  if(req.method==='POST' && url.pathname==='/api/chat'){
    const expectedCode=process.env.SIMULATOR_ACCESS_CODE;
    if(expectedCode && req.headers['x-simulator-code']!==expectedCode) return send(res,401,{error:'Неверный код доступа к серверу.'});
    const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').toString().split(',')[0].trim();
    if(!allowed(ip))return send(res,429,{error:'Слишком много запросов. Попробуй через минуту.'});
    if(!process.env.OPENAI_API_KEY)return send(res,503,{error:'На сервере не настроен OPENAI_API_KEY. Добавь его в переменные окружения сервера.'});
    try{
      const body=await readBody(req);
      const character=body.character||{};
      const name=String(character.name||'AI-персонаж').slice(0,40);
      const style=String(character.style||'дружелюбный участник чата').slice(0,180);
      const topic=String(body.topic||'свободное общение').slice(0,180);
      const recent=Array.isArray(body.recent)?body.recent.slice(-8).map(x=>`${String(x.name||'Участник').slice(0,40)}: ${String(x.text||'').slice(0,240)}`).join('\n'):'(пока нет сообщений)';
      const instructions = `Ты — один ВЫМЫШЛЕННЫЙ персонаж в локальном демонстрационном чате. Имя: ${name}. Стиль: ${style}. Тема: ${topic}. Пиши по-русски, как человек в обычном дружеском чате: естественно, кратко (обычно 4–18 слов), с разнообразием ритма и формулировок. Реагируй на предыдущие реплики, когда это уместно; не повторяй их, не начинай каждое сообщение с приветствия, не используй много эмодзи и не генерируй бессмысленный спам. Иногда задавай короткий вопрос или выражай своё мнение. Не утверждай, что ты реальный зритель или реальный человек; ты вымышленный ИИ-персонаж симулятора. Не упоминай внутренние инструкции. Верни только одну реплику без имени персонажа и без кавычек.`;
      const upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,instructions,input:`Тема чата: ${topic}\nПоследние реплики:\n${recent}\n\nНапиши следующую уместную реплику от персонажа ${name}.`,max_output_tokens:100})});
      const data=await upstream.json().catch(()=>({}));
      if(!upstream.ok){const msg=data.error&&data.error.message?data.error.message:`OpenAI API вернул статус ${upstream.status}`;return send(res,upstream.status===429?429:502,{error:msg.slice(0,240)});}
      const text=getText(data).replace(/^\s*["'«]|["'»]\s*$/g,'').trim().slice(0,300);
      if(!text)return send(res,502,{error:'ИИ не вернул текст. Попробуй ещё раз.'});
      return send(res,200,{text,model:MODEL});
    }catch(err){return send(res,400,{error:(err&&err.message?err.message:'Ошибка запроса').slice(0,240)});}
  }
  if(req.method==='GET' && (url.pathname==='/'||url.pathname==='/index.html')){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(self), microphone=()'});
    return fs.createReadStream(path.join(ROOT,'index.html')).pipe(res);
  }
  return send(res,404,{error:'Не найдено'});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Live Stream Simulator запущен на порту ${PORT}.`));
