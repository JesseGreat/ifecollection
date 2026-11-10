import { SellGate } from "@/components/SellGate";
import { SellScreen } from "./SellScreen";

export const metadata = { title: "Sell" };

export default function SellPage() {
  return (
    <SellGate>
      <SellScreen />
    </SellGate>
  );
}
