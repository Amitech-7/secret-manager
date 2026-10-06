export const MIN_PASSWORD_LENGTH = 12
export const MIN_PASSWORD_SCORE = 3

export interface PasswordCheck {
  ok: boolean
  score: number
  message: string
}

type Checker = {
  check(
    password: string,
    userInputs?: string[],
  ): { score: number; feedback: { warning: string | null } }
}
let ready: Promise<Checker> | undefined

/** The dictionaries are large, so they load on first use and never on pages that skip this. */
function load(): Promise<Checker> {
  ready ??= (async () => {
    const [core, common, en] = await Promise.all([
      import('@zxcvbn-ts/core'),
      import('@zxcvbn-ts/language-common'),
      import('@zxcvbn-ts/language-en'),
    ])
    return new core.ZxcvbnFactory({
      translations: en.translations,
      graphs: common.adjacencyGraphs,
      dictionary: { ...common.dictionary, ...en.dictionary },
    })
  })()
  return ready
}

/** `userInputs` (username etc.) are penalised so the password cannot be built from them. */
export async function checkPassword(
  password: string,
  userInputs: string[] = [],
): Promise<PasswordCheck> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, score: 0, message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }
  }
  const checker = await load()
  const result = checker.check(password, userInputs)
  if (result.score < MIN_PASSWORD_SCORE) {
    const hint = result.feedback.warning || 'Try a longer phrase of several unrelated words.'
    return { ok: false, score: result.score, message: hint }
  }
  return { ok: true, score: result.score, message: 'Strong enough.' }
}
