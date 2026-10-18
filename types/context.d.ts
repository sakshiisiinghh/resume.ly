import "react-router";

declare module "react-router" {
    interface AppLoadContext {
        // Set by the production server. Absent when running under `react-router dev`.
        ip?: string;
        requestId?: string;
        /** Per-request CSP nonce. */
        nonce?: string;
    }
}
