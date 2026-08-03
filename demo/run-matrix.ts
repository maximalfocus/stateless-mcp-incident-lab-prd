import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

type Json = Record<string, unknown>
const root = resolve(process.env.CONFORMANCE_PATH ?? '../stateless-mcp-incident-lab-conformance/conformance')
const selected = new Set(process.argv.slice(2).filter((arg) => /^[A-Z]+-\d+$/.test(arg)))

async function fixtures(category: string): Promise<{ id: string; input: Json; expected: Json }[]> {
  const base = resolve(root, category)
  const entries = await readdir(base, { withFileTypes: true })
  return await Promise.all(entries.filter((e) => e.isDirectory()).map(async (entry) => {
    const dir = resolve(base, entry.name)
    const test = JSON.parse(await readFile(resolve(dir, 'test.json'), 'utf8')) as Json
    return {
      id: String(test.spec_id),
      input: JSON.parse(await readFile(resolve(dir, 'input.json'), 'utf8')) as Json,
      expected: JSON.parse(await readFile(resolve(dir, 'expected.json'), 'utf8')) as Json,
    }
  }))
}

export async function evaluate(_input: Json): Promise<Json> {
  throw new Error('integration boundary not implemented')
}

async function main(): Promise<void> {
  const all = [...await fixtures('interoperability'), ...await fixtures('performance')]
  const tests = selected.size === 0 ? all : all.filter((test) => selected.has(test.id))
  let failed = 0
  for (const test of tests) {
    try {
      const actual = await evaluate(test.input)
      if (JSON.stringify(actual) !== JSON.stringify(test.expected)) throw new Error(`expected ${JSON.stringify(test.expected)} got ${JSON.stringify(actual)}`)
      console.log(`PASS ${test.id}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${test.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  console.log(`SUMMARY ${tests.length - failed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) await main()
