import type { Metadata } from "next";
import { HidController } from "./HidController";

export const metadata: Metadata = {
  title: "Buffering Cat · WebHID LED Controller",
  description: "Control eight CH32V003 LEDs and animations from your browser.",
};

export default function Home() {
  return <HidController />;
}
