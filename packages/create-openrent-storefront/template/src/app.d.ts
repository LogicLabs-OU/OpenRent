declare global {
  namespace App {
    interface Locals {
      /** The shop's language, for `<html lang>` and the starter's texts. */
      lang?: string;
      shop?: Promise<import('#lib/server/openrent.ts').ShopInfo>;
    }
  }
}
export {};
