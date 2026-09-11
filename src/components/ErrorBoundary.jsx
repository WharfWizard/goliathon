import { Component } from "react";

const NAVY = "#00274d", YELLOW = "#ffc72c", WHITE = "#ffffff", BORDER = "#003a6e", LIGHT = "#e8eef4";

// Catches any render-time crash below it and shows a plain, reassuring
// message instead of leaving the user staring at a black screen with no
// explanation and no way back in. This does NOT fix underlying bugs — it
// exists specifically so a crash is recoverable and visible, rather than
// silent. React error boundaries can only catch errors in their child
// component tree during rendering, not in event handlers or async code, so
// this is one layer of safety net, not a substitute for fixing root causes.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Logged to the browser console so it's visible in DevTools if a user
    // or Steve opens it to diagnose — this is deliberately NOT sent
    // anywhere else, since case data could be present in the error context
    // and this app has no server-side logging pipeline for it.
    console.error("Goliathon crashed:", error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          minHeight: "100vh",
          background: NAVY,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "'Open Sans', sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            background: "#002a57",
            border: `1px solid ${BORDER}`,
            borderRadius: 16,
            padding: 28,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 14 }}>⚠️</div>
          <h2
            style={{
              margin: "0 0 10px",
              fontFamily: "'Poppins', sans-serif",
              fontSize: 18,
              fontWeight: 800,
              color: WHITE,
            }}
          >
            Something went wrong
          </h2>
          <p style={{ margin: "0 0 6px", fontSize: 14, color: LIGHT, lineHeight: 1.7 }}>
            Goliathon hit an unexpected error and couldn't continue. This is not something you did wrong.
          </p>
          <p style={{ margin: "0 0 20px", fontSize: 14, color: YELLOW, lineHeight: 1.7 }}>
            Your case is very likely still safe — Goliathon saves your work automatically each time you add a piece of evidence.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              background: YELLOW,
              color: NAVY,
              border: "none",
              borderRadius: 8,
              fontFamily: "'Poppins', sans-serif",
              fontWeight: 700,
              fontSize: 13,
              padding: "10px 22px",
              cursor: "pointer",
              letterSpacing: 0.5,
            }}
          >
            Reload Goliathon
          </button>
          <p style={{ margin: "16px 0 0", fontSize: 12, color: "#7a96b0", lineHeight: 1.6 }}>
            If this keeps happening, please email{" "}
            <a href="mailto:steve@academyoflifeplanning.com" style={{ color: "#7a96b0" }}>
              steve@academyoflifeplanning.com
            </a>{" "}
            and let us know what you were doing when it happened.
          </p>
        </div>
      </div>
    );
  }
}
