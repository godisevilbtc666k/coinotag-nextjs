import NextAuth, { DefaultSession, DefaultUser } from "next-auth";
import { JWT as DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session {
    user: {
      /** The user's postal address. */
      id: string;
    } & DefaultSession["user"];
    // supabaseAccessToken?: string; // Eğer session'da Supabase token tutacaksanız
  }

  interface User extends DefaultUser {
    id: string;
  }
}

declare module "next-auth/jwt" {
  /** Returned by the `jwt` callback and `getToken`, when using JWT sessions */
  interface JWT extends DefaultJWT {
    /** OpenID ID Token */
    // supabaseAccessToken?: string;
    // supabaseRefreshToken?: string;
    sub: string; // Supabase user ID
  }
} 