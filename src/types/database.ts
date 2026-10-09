// Supabase Database schema types - auto-generated style, kept in sync manually.

// ─────────────────────────────────────────────
// Database schema definition
// ─────────────────────────────────────────────

export type Database = {
  public: {
    Tables: {
      import_batches: {
        Row: {
          id: number;
          file_name: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          file_name: string;
          created_at?: string;
        };
        Update: {
          id?: number;
          file_name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      suppliers: {
        Row: {
          id: number;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: number;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      drugs: {
        Row: {
          id: number;
          name: string;
          form: string | null;
          strength: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          name: string;
          form?: string | null;
          strength?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          name?: string;
          form?: string | null;
          strength?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      purchase_orders: {
        Row: {
          id: number;
          import_batch_id: number;
          supplier_id: number;
          drug_id: number;
          packaging: string | null;
          quantity: number;
          unit_count: string;
          price_per_unit: number;
          total_price: number;
          status: PurchaseOrderStatus;
          order_date: string | null;
          received_date: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          import_batch_id: number;
          supplier_id: number;
          drug_id: number;
          packaging?: string | null;
          quantity: number;
          unit_count: string;
          price_per_unit: number;
          total_price: number;
          status?: PurchaseOrderStatus;
          order_date?: string | null;
          received_date?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          import_batch_id?: number;
          supplier_id?: number;
          drug_id?: number;
          packaging?: string | null;
          quantity?: number;
          unit_count?: string;
          price_per_unit?: number;
          total_price?: number;
          status?: PurchaseOrderStatus;
          order_date?: string | null;
          received_date?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'purchase_orders_import_batch_id_fkey';
            columns: ['import_batch_id'];
            isOneToOne: false;
            referencedRelation: 'import_batches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'purchase_orders_supplier_id_fkey';
            columns: ['supplier_id'];
            isOneToOne: false;
            referencedRelation: 'suppliers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'purchase_orders_drug_id_fkey';
            columns: ['drug_id'];
            isOneToOne: false;
            referencedRelation: 'drugs';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      purchase_order_status: PurchaseOrderStatus;
    };
  };
};

// ─────────────────────────────────────────────
// Domain enums & union types
// ─────────────────────────────────────────────

/**
 * Order lifecycle: ต้องสั่งซื้อ → สั่งแล้ว → รับของแล้ว, or
 * ต้องสั่งซื้อ → สั่งแล้ว → ยกเลิก when the order never arrives.
 */
export type PurchaseOrderStatus = 'ต้องสั่งซื้อ' | 'สั่งแล้ว' | 'รับของแล้ว' | 'ยกเลิก';

// ─────────────────────────────────────────────
// Row shorthand aliases
// ─────────────────────────────────────────────

export type ImportBatchRow = Database['public']['Tables']['import_batches']['Row'];
export type SupplierRow = Database['public']['Tables']['suppliers']['Row'];
export type DrugRow = Database['public']['Tables']['drugs']['Row'];
export type PurchaseOrderRow = Database['public']['Tables']['purchase_orders']['Row'];

export type ImportBatchInsert = Database['public']['Tables']['import_batches']['Insert'];
export type SupplierInsert = Database['public']['Tables']['suppliers']['Insert'];
export type DrugInsert = Database['public']['Tables']['drugs']['Insert'];
export type PurchaseOrderInsert = Database['public']['Tables']['purchase_orders']['Insert'];

export type PurchaseOrderUpdate = Database['public']['Tables']['purchase_orders']['Update'];

// ─────────────────────────────────────────────
// Joined / hydrated query result types
// ─────────────────────────────────────────────

/** Full purchase order with nested drug and supplier data (Supabase `select … drugs(*), suppliers(*)`) */
export type PurchaseOrderWithRelations
  = Pick<PurchaseOrderRow, 'id' | 'packaging' | 'quantity' | 'unit_count' | 'price_per_unit' | 'total_price' | 'status' | 'order_date' | 'received_date'>
    & {
      import_batch_id?: number;
      created_at?: string;
      drugs: DrugRow;
      suppliers: SupplierRow;
    };

// ─────────────────────────────────────────────
// View-specific partial query result types
// (each view only SELECTs certain columns)
// ─────────────────────────────────────────────

/** OrderView query: id, quantity, unit_count, price_per_unit, total_price, packaging, drugs(*), suppliers(*) */
export type OrderViewOrder
  = Pick<PurchaseOrderRow, 'id' | 'quantity' | 'unit_count' | 'price_per_unit' | 'total_price' | 'packaging'>
    & {
      drugs: DrugRow;
      suppliers: SupplierRow;
    };

/** ReceiveView query: id, order_date, packaging, drugs(*), suppliers(*) */
export type ReceiveViewOrder
  = Pick<PurchaseOrderRow, 'id' | 'order_date' | 'packaging'>
    & {
      drugs: DrugRow;
      suppliers: SupplierRow;
    };

/** HistoryView query: id, status, order_date, received_date, packaging, drugs(*), suppliers(*) */
export type HistoryViewOrder
  = Pick<PurchaseOrderRow, 'id' | 'status' | 'order_date' | 'received_date' | 'packaging'>
    & {
      drugs: DrugRow;
      suppliers: SupplierRow;
    };

/** Extended order used in the "Receive" view with local UI state */
export type ReceivableOrder = {
  received_date_input: string;
  isSaving: boolean;
} & ReceiveViewOrder;

// ─────────────────────────────────────────────
// Grouped orders (used in OrderSummaryModal)
// ─────────────────────────────────────────────

export type SupplierOrderGroup = {
  orders: OrderViewOrder[];
};

export type GroupedOrders = Record<string, SupplierOrderGroup>;

// ─────────────────────────────────────────────
// Notification store payload
// ─────────────────────────────────────────────

export type NotificationType = 'success' | 'error' | 'info';

export type NotificationPayload = {
  message: string;
  type?: NotificationType;
};

// ─────────────────────────────────────────────
// Add-order form shape
// ─────────────────────────────────────────────

export type AddOrderFormData = {
  drugName: string;
  form: string;
  strength: string;
  supplierName: string;
  quantity: number;
  unitCount: string;
  pricePerUnit: number;
};

// ─────────────────────────────────────────────
// Quick-order catalog types
// ─────────────────────────────────────────────

/**
 * A drug row enriched with the most recently used ordering context
 * (supplier, unit count, packaging, price) derived from purchase_orders history.
 * Fields are `null` when the drug has never been ordered before.
 */
export type DrugCatalogEntry = DrugRow & {
  lastSupplierId: number | null;
  lastSupplierName: string | null;
  lastUnitCount: string | null;
  lastPackaging: string | null;
  lastPricePerUnit: number | null;
};

/**
 * Represents a single editable line item in the Quick Order draft form.
 * Each item corresponds to one drug in the catalog.
 */
export type QuickOrderDraftItem = {
  drug: DrugCatalogEntry;
  /** Whether this item has been checked for inclusion in the order */
  isSelected: boolean;
  quantity: number;
  unitCount: string;
  packaging: string;
  /** Resolved supplier ID - set after upsert; may be null for brand-new suppliers */
  supplierId: number | null;
  /** Editable supplier name; used as the source of truth for submission */
  supplierName: string;
  pricePerUnit: number;
};
