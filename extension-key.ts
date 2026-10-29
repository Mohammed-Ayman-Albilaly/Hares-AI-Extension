/**
 * Hares AI — the extension's public key, which fixes its ID.
 *
 * Chrome derives an extension's ID from its public key. Putting the key in the
 * manifest gives every build, on every machine, the same ID. That ID is then
 * stable for the backend (allow-lists) and for a forced install by policy.
 *
 * Only the public key is kept here. It cannot be used to impersonate the
 * extension. A Chrome Web Store upload gets its own key and therefore its own
 * ID; the store listing then replaces this one.
 */

export const EXTENSION_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwXC46SjFzQQpbLpgBAmjndOgAsTrKLv5GfcwvuOHHZQPPnHIgSotboh8ARj7cphwPoyLyDlZRQtfXSRS+mywLLFNX8lGiMnQDb0ulAYZdWD/7Jrso3NG9lKUHpfP6p3aOeTX/bc/N55vk91M9VwZoN1+amcCKkPedHc+APbrnmwVMcIZy44zAp5Ob+sJJwxxsDuq8XuzB6jwvpJdyEgkGVlmnZrJY2mjfybkeRYGyP0BxYfWYuLlEBKVs4u8QqYRz31aRWuC1DbeycETw8T7aaO8enYi0ArmMtvl+09iWZViOzzLYEvEbS0zi43wh0j4TVoiMLRJLn0NMXNwBf7RrwIDAQAB';

/** The ID that `EXTENSION_PUBLIC_KEY` gives (checked by a test). */
export const EXTENSION_ID = 'hbcjnfojlcbfaiiiepmlhcjbmjbcpold';
