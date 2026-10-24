import type { OnboardingPage } from '@eliza/contracts';
export type TourStep = { selector: string; title: string; body: string };
export type Tour = { version: number; steps: TourStep[] };
export const pageTours: Record<OnboardingPage, Tour> = {
  overview: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Overview',
        body: 'Start here to see how your store is doing today. Figures follow your store’s timezone.',
      },
      {
        selector: '.today-metrics',
        title: 'Today’s results',
        body: 'Review sales, costs and profitability. An approximate sign means the figure uses estimated costs.',
      },
      {
        selector: '.overview-actions, .attention-panel, .overview-grid',
        title: 'What needs attention',
        body: 'Review operational issues and follow the links to the relevant products or shifts.',
      },
    ],
  },
  products: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Products',
        body: 'Keep product names, barcodes, selling prices and other catalog information here.',
      },
      {
        selector: '.page-heading .button',
        title: 'Create a product',
        body: 'Add a product card. Purchase cost and selling price can be left blank and entered later.',
      },
      {
        selector: '.table-toolbar',
        title: 'Find the right product',
        body: 'Search by name, barcode, SKU or PLU, or use the scanner. Open Edit to change a product.',
      },
    ],
  },
  inventory: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Inventory',
        body: 'Track stock changes and check how each product’s balance was formed.',
      },
      {
        selector: '.page-heading .button',
        title: 'Adjust stock carefully',
        body: 'Record an opening balance or a stock correction with a reason. Receive supplier deliveries through Purchases.',
      },
      {
        selector: '.movement-filters',
        title: 'Find a stock movement',
        body: 'Filter the history by product, text or dates. Clear filters to return to the full history.',
      },
    ],
  },
  replenishment: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Replenishment',
        body: 'Plan what to buy using completed sales history and available stock. Suggestions do not place orders.',
      },
      {
        selector: '.replenishment-filters',
        title: 'Choose planning assumptions',
        body: 'Set the sales history, review cycle and safety days, then apply the filters.',
      },
      {
        selector: '.replenishment-table, .replenishment-page .notice',
        title: 'Review before ordering',
        body: 'Compare demand, current stock and incoming deliveries. Review uncertainty before creating a shopping list.',
      },
    ],
  },
  'shopping-lists': {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Shopping lists',
        body: 'Prepare purchases in groups, then review quantities and suppliers before ordering.',
      },
      {
        selector: '.page-heading .button',
        title: 'Create a shopping list',
        body: 'Create a list and choose stock thresholds for piece and kilogram products. Items are grouped by category.',
      },
      {
        selector: '.shopping-detail, .panel',
        title: 'Review and share',
        body: 'Open a list to adjust quantities, add custom groups and prepare a supplier message for manager review.',
      },
    ],
  },
  'stock-counts': {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Stock counts',
        body: 'Compare physically counted stock with the recorded balance. Starting a count does not change inventory.',
      },
      {
        selector: '.page-heading .button',
        title: 'Start a count',
        body: 'Choose the products and record what is actually on the shelf or in storage.',
      },
      {
        selector: '.panel',
        title: 'Review differences',
        body: 'Open a count to review differences before finalizing it. Finalizing records the inventory correction.',
      },
    ],
  },
  suppliers: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Suppliers',
        body: 'Keep supplier contacts and purchasing details together.',
      },
      {
        selector: '.page-heading .button',
        title: 'Add a supplier',
        body: 'Enter the supplier’s details, including a WhatsApp number when you want to prepare order messages.',
      },
      {
        selector: '.panel',
        title: 'Find and edit contacts',
        body: 'Open a supplier to review or update contact information before preparing a purchase order.',
      },
    ],
  },
  purchases: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Purchases',
        body: 'Create supplier orders and record the goods actually received. An order alone does not add stock.',
      },
      {
        selector: '.page-heading .button',
        title: 'Prepare an order',
        body: 'Choose a supplier, add products and review quantities and purchase costs before placing the order.',
      },
      {
        selector: '.panel, .purchase-document',
        title: 'Receive the delivery',
        body: 'Open an order to record received quantities, actual costs and expiry batches. Partial deliveries are supported.',
      },
    ],
  },
  'digital-purchases': {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Digital purchases',
        body: 'Review supplier documents separately from orders and inventory transactions.',
      },
      {
        selector: '.table-toolbar, .digital-purchases-heading',
        title: 'Find a document',
        body: 'Search saved documents or open a document in Eliza AI for review.',
      },
      {
        selector: '.digital-purchases-panel, .digital-purchases-page',
        title: 'Verify extracted information',
        body: 'AI-extracted data needs review. Saving a document does not automatically receive stock or create a sale.',
      },
    ],
  },
  ai: {
    version: 1,
    steps: [
      {
        selector: '.ai-main',
        title: 'Eliza AI',
        body: 'Ask questions about your store or review supplier documents with the assistant.',
      },
      {
        selector: '.ai-composer',
        title: 'Ask or attach a document',
        body: 'Ask about sales, inventory or purchasing. Attach a supplier document to turn it into editable records.',
      },
      {
        selector: '.ai-thread',
        title: 'Review proposed changes',
        body: 'Read the answer and review proposed actions. Store changes require your explicit approval.',
      },
    ],
  },
  analytics: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Analytics',
        body: 'Explore store performance for the selected period. All financial summaries use the shared financial engine.',
      },
      {
        selector: '.period-tabs, .period-switch, .page-heading',
        title: 'Choose the period',
        body: 'Switch the reporting period to compare sales and store performance over time.',
      },
      {
        selector: '.today-financial-metrics, .financial-metrics, .panel',
        title: 'Read financial results',
        body: 'Revenue, cost of goods sold and operating profit mean different things. Approximate values indicate estimated costs.',
      },
    ],
  },
  'action-center': {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Manager Action Center',
        body: 'Review issues that need a manager’s attention and decide what to do next.',
      },
      {
        selector: '.action-tabs',
        title: 'Choose an action group',
        body: 'Use the tabs to focus on one type of issue instead of reviewing everything at once.',
      },
      {
        selector: '.action-list, .action-filter',
        title: 'Review the impact',
        body: 'Read the issue and its estimated impact, then open the relevant workflow to resolve it.',
      },
    ],
  },
  sales: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Sales',
        body: 'Find completed receipts and review their actual selling prices, discounts and payments.',
      },
      {
        selector: '.panel',
        title: 'Open a receipt',
        body: 'Open a receipt to inspect its line items and any recorded refunds. The receipt and refund form are separate screens.',
      },
      {
        selector: '.history-pagination, .movement-pagination, .page-heading',
        title: 'Browse sales history',
        body: 'Use the history controls to browse older sales. Only completed transactions appear here.',
      },
    ],
  },
  shifts: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Shifts',
        body: 'Review register shifts, cash movements and closing differences.',
      },
      {
        selector: '.panel-heading',
        title: 'Review the cash drawer',
        body: 'Compare expected and counted cash. Cash movements should be recorded with the relevant shift.',
      },
      {
        selector: '.panel',
        title: 'Inspect a shift',
        body: 'Open shift details to understand its sales, cash movements and closing result.',
      },
    ],
  },
  audit: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Audit log',
        body: 'See which employee performed an action and when it happened.',
      },
      {
        selector: '.panel',
        title: 'Review recorded actions',
        body: 'Use this history to investigate changes. Audit records describe actions; they do not replace receipts or stock movements.',
      },
    ],
  },
  team: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Team',
        body: 'Manage employee profiles, roles and access to store devices.',
      },
      {
        selector: '.page-heading .button',
        title: 'Create an employee',
        body: 'Add personal and contact details, assign roles, and configure PIN or QR access.',
      },
      {
        selector: '.team-role-list, .panel',
        title: 'Keep permissions appropriate',
        body: 'Review each employee’s roles and deactivate access when it is no longer needed.',
      },
    ],
  },
  devices: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Devices',
        body: 'Assign each phone, tablet or computer to its role in the store.',
      },
      {
        selector: '.page-heading .button',
        title: 'Connect a device',
        body: 'Create a device and choose its workspace: Checkout, Price Tags, Price Checker or Management.',
      },
      {
        selector: '.device-grid, .devices-grid, .panel',
        title: 'Manage device access',
        body: 'Review assignments and block or remove devices that should no longer access the store.',
      },
    ],
  },
  settings: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Settings',
        body: 'Configure store details, language, taxes and printing preferences.',
      },
      {
        selector: '.store-settings-section',
        title: 'Review store defaults',
        body: 'Check business details, timezone and default settings before daily use.',
      },
      {
        selector: '.store-settings-save',
        title: 'Save your changes',
        body: 'Save after editing. Receipt and label settings control what customers see on printed documents.',
      },
    ],
  },
  'store-layout': {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Store layout',
        body: 'Build a visual plan of your store and arrange equipment to match the space.',
      },
      {
        selector: '.store-layout-catalog',
        title: 'Choose equipment',
        body: 'Add shelves, refrigerators, freezers, checkouts or produce displays from the catalog.',
      },
      {
        selector: '.store-layout-canvas-panel',
        title: 'Arrange and inspect',
        body: 'Move and rotate equipment. In 3D, drag to rotate the view and use the mouse wheel to zoom. Save the finished layout.',
      },
    ],
  },
  expenses: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Expenses',
        body: 'Record operating expenses separately from product purchase costs.',
      },
      {
        selector: '.page-heading .button',
        title: 'Record an expense',
        body: 'Enter the amount, date and category so the expense is included in the correct reporting period.',
      },
      {
        selector: '.expenses-filters',
        title: 'Review the period',
        body: 'Filter expense history by dates or category and compare it with operating profit in analytics.',
      },
    ],
  },
  promotions: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Promotions',
        body: 'Manage product and category promotions and individual unit markdowns in one place.',
      },
      {
        selector: '.promotion-target-step, .unit-markdown-picker',
        title: 'Choose eligible products',
        body: 'Choose products or categories for a promotion, or select one product in Unit markdowns to discount a limited number of items.',
      },
      {
        selector: '.promotion-settings, .unit-markdown-settings',
        title: 'Set the discount and timing',
        body: 'Choose a discount, set the schedule and review before saving. Use unit markdown labels for selected physical items.',
      },
    ],
  },
  pos: {
    version: 1,
    steps: [
      {
        selector: '.pos-heading',
        title: 'Checkout',
        body: 'Scan products, review the cart and record payment. This guide does not add items or create transactions.',
      },
      {
        selector: '.pos-search',
        title: 'Scan or search',
        body: 'Scan a barcode or search for a product. Discounted unit labels apply their own saved price.',
      },
      {
        selector: '.pos-cart',
        title: 'Review before payment',
        body: 'Check quantities and the total, then take payment. You can hold the cart when the customer needs to wait.',
      },
    ],
  },
  'price-tags': {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Price Tags',
        body: 'Prepare shelf tags and individual markdown labels for the shop floor.',
      },
      {
        selector: '.price-tags-tabs, .price-tags-bottom-nav',
        title: 'Choose the label type',
        body: 'Switch between changed prices, all products and individual markdown labels.',
      },
      {
        selector: '.price-tags-print-action',
        title: 'Review and print',
        body: 'Select the required tags and review the print layout. Attach each markdown label to the correct physical item.',
      },
    ],
  },
  receipt: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Receipt',
        body: 'Review the original sale and its recorded refunds without changing the receipt.',
      },
      {
        selector: '.receipt-page-paper',
        title: 'Read the receipt',
        body: 'Check the products, regular prices, discounts and the amount actually paid.',
      },
      {
        selector: '.receipt-refund-history, .receipt-page-header .button',
        title: 'Refund separately',
        body: 'Start a refund from its dedicated action. Refunds are recorded separately from the original sale.',
      },
    ],
  },
  refund: {
    version: 1,
    steps: [
      {
        selector: '.page-heading, .receipt-page-header, h1',
        title: 'Refund items',
        body: 'Choose what the customer is returning. No refund is recorded until you confirm the form.',
      },
      {
        selector: '.refund-item, .refund-page-panel',
        title: 'Choose returned quantities',
        body: 'Select only the returned items and quantities. The form shows what remains refundable.',
      },
      {
        selector: '.refund-total-preview, .refund-form-heading',
        title: 'Review the refund',
        body: 'Review the amount, stock restoration and payment details before confirming the refund.',
      },
    ],
  },
  'price-check': {
    version: 1,
    steps: [
      {
        selector: '.price-check-header',
        title: 'Price checker',
        body: 'Check a product’s current selling price without opening a cart or making a purchase.',
      },
      {
        selector: '.price-check-scanner',
        title: 'Scan the barcode',
        body: 'Hold the product barcode in front of the scanner, or enter it in the field below.',
      },
      {
        selector: '.price-check-result',
        title: 'See the product',
        body: 'The result shows product information and any applicable selling discount. Purchase costs are never shown here.',
      },
    ],
  },
};
export function onboardingPage(pathname: string): OnboardingPage | null {
  if (/^\/(pos|sales)\/receipts\/[^/]+\/refund\/?$/.test(pathname)) return 'refund';
  if (/^\/(pos|sales)\/receipts\/[^/]+\/?$/.test(pathname)) return 'receipt';
  const key = pathname.replace(/^\/|\/$/g, '') || 'overview';
  return Object.hasOwn(pageTours, key) ? (key as OnboardingPage) : null;
}
