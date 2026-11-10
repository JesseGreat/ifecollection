import { SellGate } from "@/components/SellGate";
import { Checkout } from "./Checkout";

export const metadata = { title: "Checkout" };

export default function CheckoutPage() {
  return (
    <SellGate>
      <Checkout />
    </SellGate>
  );
}
