import { test, expect } from "@playwright/test";

// Exercise App's real event listener and translations without audio or a provider.
for (const language of ["en", "de"]) {
  test(`post-processing fallback warning is localized (${language})`, async ({
    page,
  }) => {
    await page.addInitScript((language) => {
      const callbacks = new Map<number, (event: unknown) => void>();
      const listeners = new Map<string, Set<number>>();
      let nextId = 0;
      const settings = {
        onboarding_completed: false,
        app_language: language,
        theme: "system",
        bindings: {},
        custom_words: [],
        post_process_providers: [],
        post_process_prompts: [],
      };
      const mockWindow = window as typeof window & {
        __TAURI_INTERNALS__: unknown;
        __TAURI_OS_PLUGIN_INTERNALS__: unknown;
        __TAURI_EVENT_PLUGIN_INTERNALS__: unknown;
        emitHandyTestEvent: (event: string) => void;
        hasHandyTestListener: (event: string) => boolean;
      };
      mockWindow.__TAURI_OS_PLUGIN_INTERNALS__ = { platform: "macos" };
      const unregisterListener = (event: string, id: number) => {
        listeners.get(event)?.delete(id);
        callbacks.delete(id);
      };
      mockWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener };
      mockWindow.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: (callback: (event: unknown) => void) => {
          callbacks.set(++nextId, callback);
          return nextId;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
          if (cmd === "plugin:event|listen") {
            const event = args.event as string;
            const ids = listeners.get(event) ?? new Set<number>();
            ids.add(args.handler as number);
            listeners.set(event, ids);
            return args.handler;
          }
          if (cmd === "plugin:event|unlisten") {
            unregisterListener(args.event as string, args.eventId as number);
          }
          if (cmd === "get_app_settings" || cmd === "get_default_settings") {
            return settings;
          }
          if (
            cmd === "get_available_models" ||
            cmd === "get_transcription_jobs"
          ) {
            return [];
          }
          return false;
        },
      };
      mockWindow.hasHandyTestListener = (event) =>
        (listeners.get(event)?.size ?? 0) > 0;
      mockWindow.emitHandyTestEvent = (event) => {
        for (const id of listeners.get(event) ?? []) {
          callbacks.get(id)?.({ event, id, payload: null });
        }
      };
    }, language);
    await page.goto("/");
    await page.waitForFunction(
      () =>
        (
          window as typeof window & {
            hasHandyTestListener: (event: string) => boolean;
          }
        ).hasHandyTestListener("post-processing-error") &&
        document.querySelector("#root")?.childElementCount,
    );
    const title =
      language === "de"
        ? "Nachbearbeitung fehlgeschlagen"
        : "Post-processing Failed";
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      (
        window as typeof window & {
          emitHandyTestEvent: (event: string) => void;
        }
      ).emitHandyTestEvent("post-processing-error");
    });
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        language === "de"
          ? "Die ursprüngliche Transkription wird verwendet."
          : "Using the original transcription.",
        { exact: false },
      ),
    ).toBeVisible();
    const warning = page.locator("[data-sonner-toast]");
    await expect(warning).toHaveCount(1);
    await expect(warning).toHaveAttribute("data-mounted", "true");
    const screenshot = test.info().outputPath("post-processing-warning.png");
    await warning.screenshot({ path: screenshot });
    await test.info().attach("post-processing-warning", {
      path: screenshot,
      contentType: "image/png",
    });
  });
}
