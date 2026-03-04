import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import JoinView from "./JoinView.jsx";

function renderJoinView() {
  return render(
    <MemoryRouter initialEntries={["/join-room"]}>
      <Routes>
        <Route path="/" element={<div data-testid="landing" />} />
        <Route path="/join-room" element={<JoinView />} />
        <Route
          path="/listen/:roomId"
          element={<div data-testid="listen-view" />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("JoinView", () => {
  test("input renders empty", () => {
    renderJoinView();
    expect(screen.getByPlaceholderText("XXXXXX")).toHaveValue("");
  });

  test("Join is a disabled button when input has fewer than 4 chars", async () => {
    const user = userEvent.setup();
    renderJoinView();
    await user.type(screen.getByPlaceholderText("XXXXXX"), "AB");
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  });

  test("Join becomes a link when 4+ chars are entered", async () => {
    const user = userEvent.setup();
    renderJoinView();
    await user.type(screen.getByPlaceholderText("XXXXXX"), "ABCD");
    expect(screen.getByRole("link", { name: "Join" })).toBeInTheDocument();
  });

  test("clicking Join link navigates to /listen/CODE", async () => {
    const user = userEvent.setup();
    renderJoinView();
    await user.type(screen.getByPlaceholderText("XXXXXX"), "ABCDEF");
    await user.click(screen.getByRole("link", { name: "Join" }));
    expect(screen.getByTestId("listen-view")).toBeInTheDocument();
  });

  test("back link navigates to /", async () => {
    const user = userEvent.setup();
    renderJoinView();
    await user.click(screen.getByRole("link", { name: /← Back/i }));
    expect(screen.getByTestId("landing")).toBeInTheDocument();
  });
});
