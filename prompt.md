# Production Schedule Reflow - Technical Test

## Overview

You are tasked with building a production schedule reflow system for a manufacturing facility. When disruptions occur (delays, machine breakdowns), the system must intelligently reschedule work orders while respecting various constraints and dependencies.

**6-hour timebox:** If you run out of time, no worries! Just add `@upgrade` comments on incomplete parts explaining what you'd build next. We want to see how you think and prioritize.

**AI Tools:** Feel free to use AI assistant to help with test data generation, debugging, algorithm exploration, or edge case analysis. If you use AI for key decisions (e.g., analyzing constraints, designing the reflow logic), save those prompts in a markdown file, we'd love to see your problem-solving process!

**Example of production schedule view:** https://www.planningpme.us/img/production-schedule.jpg

---

## At a Glance

**What you're building:** A production scheduler that reschedules work orders when disruptions occur

**Must handle:**
- Dependencies (A must finish before B)
- Work center conflicts (no overlaps)
- Shift boundaries (work pauses outside shifts)
- Maintenance windows (blocked time)

**Required deliverables:**
1. Working algorithm (TypeScript)
2. Sample data (3+ scenarios)
3. Loom demo (5-10 min)
4. GitHub repo with README

**Bonus (optional):**
- Automated test suite
- More sample data
- DAG implementation
- Optimization metrics
- AI prompts documentation

---

## The Problem

A manufacturing facility runs multiple extrusion lines producing plastic pipes. Work orders are scheduled across these lines, but real-world disruptions constantly require rescheduling:

- A work order runs longer than expected, delaying everything downstream
- A work center goes down for maintenance (planned or unplanned)
- Work orders have dependencies (Order B can't start until Order A finishes)
- Different work centers have different shift schedules
- Some work orders are maintenance tasks that cannot be moved

Your job is to create a **reflow algorithm**. A reflow algorithm will look at all the work orders from a time interval perspective and will update those times in order to produce a valid schedule that respects all constraints.

## Core Requirements

### 1. The Reflow Algorithm

**Takes:**
- Work orders with start/end dates
- Work centers with shifts and maintenance windows
- Dependencies between orders

**Produces:**
- Valid schedule with updated dates
- List of changes (what moved, by how much)
- Explanation (why it changed)

**Key Rules:**
- Work orders take their full `durationMinutes` to complete
- Work pauses outside shift hours, resumes in next shift
- No work during maintenance windows
- All parent dependencies must complete before child starts

**Example:** Work order needs 120 min, starts Mon 4PM, shift ends 5PM (Mon-Fri 8AM-5PM)
→ Works 60 min Mon (4PM-5PM) → Pauses → Resumes Tue 8AM → Completes 9AM

### 2. Constraints (Hard Requirements)

Your algorithm MUST respect:

**Work Center:**
- Only one order at a time (no overlaps)
- Respect shift schedules
- No work during maintenance windows

**Dependencies:**
- Multiple parents allowed (all must complete first)
- Can form chains (A → B → C)

**Time:**
- Work only during shift hours
- Maintenance windows cannot be changed
- Maintenance work orders cannot be rescheduled

### 3. Goal

**Produce a valid schedule** where:
- No work center conflicts
- All dependencies satisfied
- All work within shift hours
- Maintenance windows respected

## Data Structures

All documents follow this structure:
```typescript
{
  docId: string;        // Unique identifier
  docType: string;      // Document type
  data: {
    // Document-specific fields
  }
}
```

### Work Order
```typescript
{
  docId: string;
  docType: "workOrder";
  data: {
    workOrderNumber: string;
    manufacturingOrderId: string;
    workCenterId: string;
    
    // Timing
    startDate: string;              
    endDate: string;                
    durationMinutes: number;        // Total working time required
    
    // Constraints
    isMaintenance: boolean;         // Cannot be rescheduled if true
    
    // Dependencies (can have multiple parents)
    dependsOnWorkOrderIds: string[]; // All must complete before this starts
  }
}
```

### Work Center
```typescript
{
  docId: string;
  docType: "workCenter";
  data: {
    name: string;
    
    // Shifts
    shifts: Array<{
      dayOfWeek: number;           // 0-6, Sunday = 0
      startHour: number;           // 0-23
      endHour: number;             // 0-23
    }>;
    
    // Maintenance windows (blocked time periods)
    maintenanceWindows: Array<{
      startDate: string;           
      endDate: string;             
      reason?: string;             // Optional description
    }>;
  }
}
```

### Manufacturing Order
```typescript
{
  docId: string;
  docType: "manufacturingOrder";
  data: {
    manufacturingOrderNumber: string;
    itemId: string;
    quantity: number;
    dueDate: string;               
  }
}
```

## What You Need to Deliver

### 1. Working Algorithm (Required)

Build the reflow scheduler that handles:
- Dependencies (multiple parents)
- Work center conflicts
- Shift boundaries (pause/resume)
- Maintenance windows

Suggested structure:
```
src/
├── reflow/
│   ├── reflow.service.ts          # Main algorithm
│   ├── constraint-checker.ts      # Validation logic
│   └── types.ts                   # TypeScript types
└── utils/
    └── date-utils.ts              # Date helpers (Luxon)
```

### 2. Sample Data (Required)

Create sample data for at least **2 scenarios**:

1. **Delay Cascade**: One order delayed → affects downstream orders
2. **Shift or Maintenance**: Order spans shifts OR conflicts with maintenance

Can be hardcoded or in JSON files. Just needs to demonstrate your algorithm works.

### 3. Documentation (Required)

- **Code comments** explaining key logic
- **README.md** with:
  - How to run your code
  - High-level algorithm approach
  - Setup instructions

### 4. Demo Video (Required)

**5-10-minute Loom video** showing:
- Your code running with sample data
- Output for both scenarios (what changed, why)
- Walkthrough of your algorithm approach

### 5. Public Repository (Required)

**GitHub/GitLab repo** with:
- Working code (runnable)
- Sample data
- README
- Clean commit history

## Bonus Points (Optional - Show Off Your Skills!)

If you finish early or want to showcase advanced capabilities:

### Bonus Features:

- **DAG (Directed Acyclic Graph)** implementation for dependency management
  - Topological sort for optimal ordering
  - Cycle detection (circular dependencies)

- **Automated test suite**: Write formal tests (Jest/Vitest) covering:
  - 3+ scenarios with proper assertions
  - Edge cases (circular dependencies, impossible schedules)
  - Constraint validation tests
  - This is highly valued but not required due to time constraints

- **Setup time handling**: Work orders have `setupTimeMinutes` before production starts
  - Add to Work Order: `setupTimeMinutes?: number`
  - Setup time counts as working time within shifts

- **Additional scenarios** (3+ beyond the required 2):
  - Complex multi-constraint scenarios (dependencies + maintenance + shifts)
  - Resource conflict resolution with multiple competing orders
  - Impossible schedule detection (explain why constraints cannot be satisfied)

- **Optimization metrics**:
  - Calculate total delay introduced: `Σ (new_end_date - original_end_date)`
  - Minimize number of work orders affected
  - Track utilization metrics: `(total working minutes) / (total available shift minutes)`
  - Work center idle time analysis

- **Document your AI prompts**: Save prompts you used in markdown files (shows collaboration approach)
  - Example: `prompts/algorithm-design.md`, `prompts/shift-calculation.md`

- **Enhanced documentation**:
  - Trade-offs you considered (why this approach over alternatives?)
  - Known limitations (what doesn't work yet?)
  - Tag future improvements with `@upgrade` comments in code

- **Clean git history**:
  - Meaningful commit messages
  - Logical progression of features
  - Separate commits for major features

## Evaluation Criteria

Your submission will be evaluated on:

### Algorithm Correctness (80%)
- **Constraint Satisfaction (40%)**: Respects ALL hard constraints
  - Work center conflicts (no overlaps)
  - Dependencies (all parents complete before child)
  - Shifts (work only during operating hours)
  - Maintenance windows (no work during maintenance)
- **Valid Schedule Generation (30%)**: Produces schedules that actually work
  - Correct start/end date calculations
  - Proper shift boundary handling
  - Maintenance windows properly avoided
  - **Demonstrated working in Loom video**
- **Handles Required Scenarios (10%)**: At least 2 scenarios demonstrated

### Problem Solving (20%)
- **Code Quality (10%)**:
  - Clean, readable TypeScript with proper types
  - Good separation of concerns
  - Proper error handling
- **Algorithm Design (5%)**:
  - Logical approach to solving the scheduling problem
  - Efficient constraint checking
- **Communication (5%)**:
  - Clear explanation in Loom demo
  - Understandable code comments
  - Good documentation

### Bonus Points (Extra Credit)
- Automated test suite (highly valued)
- DAG implementation with cycle detection
- Setup time handling
- Additional scenarios (3+)
- Optimization features (delay metrics, utilization)
- AI prompt documentation
- Enhanced documentation (trade-offs, complexity analysis)
- Git commit quality

## Hints & Tips

**Start simple, add complexity gradually:**
1. Get basic reflow working (ignore shifts)
2. Add dependencies
3. Add work center conflicts
4. Add shift logic (hardest part!)
5. Add maintenance windows

**Shift logic is the trickiest part:**
- Use **Luxon** for date manipulation (strongly recommended)
- Create helper: `calculateEndDateWithShifts(startDate, duration, shifts)`
- Remember: work pauses outside shifts, resumes in next shift

**Suggested constraint checking order:**
Dependencies → Work Center Conflicts → Shifts → Maintenance

**Key considerations:**
- All dates in UTC
- Track working minutes, not elapsed time
- Maintenance windows = blocked time on work centers

## Common Questions

**Q: What if there's no valid solution?**  
A: Throw an error explaining which constraints can't be satisfied.

**Q: Can I use libraries like Luxon?**  
A: Yes! Luxon is highly recommended for date handling.

**Q: How should work orders span across shifts?**  
A: They pause during non-working hours and resume in the next shift.
- Example: 120-min order starts Mon 4PM, shift ends 5PM (Mon-Fri 8AM-5PM)
- Works 60 min Monday → pauses → resumes Tue 8AM → completes 9AM

**Q: Can work orders have multiple parent dependencies?**  
A: Yes! ALL parents must complete before the child starts.

**Q: What if I don't finish in 6 hours?**  
A: Submit what you have! A working core solution is better than an incomplete one with bonuses.

## Submission

Provide:
1. **Public GitHub/GitLab repository** with:
  - Working code (TypeScript)
  - Sample data for 3+ scenarios
  - README with setup and approach
  - Clean commit history
2. **Loom video** (max 10 minutes) demonstrating your solution
3. **(Bonus)** Automated test suite
4. **(Bonus)** Markdown files with AI prompts you used

---

## Example Usage (Not Required, Just for Context)

Here's what using your reflow service might look like:

```typescript
const reflowService = new ReflowService();

const result = reflowService.reflow({
  workOrders: [...],      // Current work orders
  workCenters: [...],     // Work centers with shifts and maintenance
  manufacturingOrders: [...] // Manufacturing orders for context
});

console.log(result.updatedWorkOrders);  // New schedule
console.log(result.changes);             // What changed
console.log(result.explanation);         // Why it changed
```


---


**Good luck! We're excited to see your solution.** 🚀

**Naologic Team**





