/**
 * Desktop Layout
 *
 * Overrides the root layout for the /desktop route. Injects a style tag
 * that forces html and body to have transparent backgrounds. This is
 * required for the AR transparency chain: Puppeteer's omitBackground
 * only produces alpha=0 pixels if the page itself has no background.
 */
export default function DesktopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            html, body {
              background: transparent !important;
            }
          `,
        }}
      />
      {children}
    </>
  );
}
