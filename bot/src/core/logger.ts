export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(scope: string): Logger;
}

const debugEnabled = /^(1|true|yes)$/i.test(process.env.KLOTZI_DEBUG ?? '');

export function createLogger(scope = 'klotzi'): Logger {
  const prefix = () => `${new Date().toISOString()} [${scope}]`;
  return {
    debug: (...args) => debugEnabled && console.debug(prefix(), ...args),
    info: (...args) => console.info(prefix(), ...args),
    warn: (...args) => console.warn(prefix(), ...args),
    error: (...args) => console.error(prefix(), ...args),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}
