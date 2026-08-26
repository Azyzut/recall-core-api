// Next.js instrumentation — runs once at server startup

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initFM } = await import('@recall/shared/fm');
    await initFM();
  }
}
