// PaymentModalContext.jsx
import { createContext, useContext, useState } from "react";

const PaymentModalContext = createContext();

export function PaymentModalProvider({ children }) {
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  const openPaymentModal = () => setIsPaymentModalOpen(true);
  const closePaymentModal = () => setIsPaymentModalOpen(false);

  return (
    <PaymentModalContext.Provider value={{ isPaymentModalOpen, openPaymentModal, closePaymentModal }}>
      {children}
    </PaymentModalContext.Provider>
  );
}

export const usePaymentModal = () => useContext(PaymentModalContext);