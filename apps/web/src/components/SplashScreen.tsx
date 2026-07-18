export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex size-24 items-center justify-center"
        aria-label="SIBS Code splash screen"
      >
        <img alt="SIBS Code" className="size-16 object-contain" src="/apple-touch-icon.png" />
      </div>
    </div>
  );
}
