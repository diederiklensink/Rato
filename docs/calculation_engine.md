# calculation_engine.md

## 1. Core Settlement Logic (`src/utils/calculations.ts`)
The engine calculates the monthly transfer targets and personal discretionary budgets based on active income, active fixed expenses, and the selected calculation mode. 

```typescript
export function calculateSettlement(
  user1Income: number,
  user2Income: number,
  totalJointExpenses: number,
  jointIncome: number, // e.g., toeslagen
  mode: CalculationMode
) {
  const totalIncome = user1Income + user2Income;
  const netJointCosts = totalJointExpenses - jointIncome;

  let user1Contribution = 0;
  let user2Contribution = 0;

  switch (mode) {
    case 'pro_rata':
      const user1Pct = user1Income / totalIncome;
      const user2Pct = user2Income / totalIncome;
      user1Contribution = netJointCosts * user1Pct;
      user2Contribution = netJointCosts * user2Pct;
      break;
    
    case 'fifty_fifty':
      user1Contribution = netJointCosts / 2;
      user2Contribution = netJointCosts / 2;
      break;

    case 'equal_remainder':
      const totalLeft = totalIncome - netJointCosts;
      const equalShare = totalLeft / 2;
      user1Contribution = user1Income - equalShare;
      user2Contribution = user2Income - equalShare;
      break;
  }

  return {
    user1Contribution,
    user2Contribution,
    user1Free: user1Income - user1Contribution,
    user2Free: user2Income - user2Contribution
  };
}