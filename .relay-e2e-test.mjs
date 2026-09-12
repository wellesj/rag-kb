// E2E test: spawn the relay stdio proxy and call doctor + list_workspaces via MCP JSON-RPC
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const proxyPath = 'C:/Users/walle/.dsh/profiles/web/node_modules/harness-relay-mcp/dist/dsh-relay-proxy.mjs'
const child = spawn(process.execPath, [proxyPath], {
  env: { ...process.env, DSH_RELAY_CLIENT_PRINCIPAL_ID: 'e2e-test', DSH_RELAY_ENDPOINT_DESCRIPTOR: 'C:/Users/walle/.dsh/plugins/dsh-relay/web/relay-endpoint.json' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let stderr = ''
child.stderr.on('data', d => { stderr += d })
const rl = createInterface({ input: child.stdout })
const pending = new Map()
let nextId = 1
rl.on('line', line => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)) }, 30000)
    pending.set(id, m => { clearTimeout(timer); resolve(m) })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}
try {
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })
  console.log('=== initialize ===')
  console.log(JSON.stringify(init, null, 2))
  await rpc('notifications/initialized', {})
  const tools = await rpc('tools/list', {})
  console.log('=== tools ===')
  if (tools.result?.tools) console.log(tools.result.tools.map(t => t.name).join(', '))
  else console.log(JSON.stringify(tools, null, 2))
  const doctor = await rpc('tools/call', { name: 'doctor', arguments: {} })
  console.log('=== doctor ===')
  console.log(JSON.stringify(doctor, null, 2))
  const ws = await rpc('tools/call', { name: 'list_workspaces', arguments: {} })
  console.log('=== list_workspaces ===')
  console.log(JSON.stringify(ws, null, 2))
} catch (e) {
  console.error('E2E FAILED:', e.message)
  if (stderr) console.error('proxy stderr:', stderr.slice(0, 2000))
}
child.kill()
