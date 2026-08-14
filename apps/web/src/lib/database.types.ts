export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      finance_bank_account: {
        Row: {
          bank_account: string | null
          bank_id: string
          bank_name: string | null
          card_number: string | null
          company_id: string
          entity_id: string
          is_card: boolean | null
          status: boolean
        }
        Insert: {
          bank_account?: string | null
          bank_id: string
          bank_name?: string | null
          card_number?: string | null
          company_id: string
          entity_id: string
          is_card?: boolean | null
          status?: boolean
        }
        Update: {
          bank_account?: string | null
          bank_id?: string
          bank_name?: string | null
          card_number?: string | null
          company_id?: string
          entity_id?: string
          is_card?: boolean | null
          status?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_bank_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_bank_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
      finance_closing: {
        Row: {
          closing: boolean
          closing_date: string | null
          company_id: string
          company_year_id: string
          entity_id: string
        }
        Insert: {
          closing?: boolean
          closing_date?: string | null
          company_id: string
          company_year_id: string
          entity_id: string
        }
        Update: {
          closing?: boolean
          closing_date?: string | null
          company_id?: string
          company_year_id?: string
          entity_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_closing_year"
            columns: ["company_id", "entity_id", "company_year_id"]
            isOneToOne: true
            referencedRelation: "system_year"
            referencedColumns: ["company_id", "entity_id", "company_year_id"]
          },
          {
            foreignKeyName: "fk_closing_year"
            columns: ["company_id", "entity_id", "company_year_id"]
            isOneToOne: true
            referencedRelation: "v_finance_closing"
            referencedColumns: ["company_id", "entity_id", "company_year_id"]
          },
        ]
      }
      finance_dimension: {
        Row: {
          company_id: string
          dimension_id: string
          dimension_name: string | null
          entity_id: string
          slot_no: number
          status: boolean
        }
        Insert: {
          company_id: string
          dimension_id: string
          dimension_name?: string | null
          entity_id: string
          slot_no: number
          status?: boolean
        }
        Update: {
          company_id?: string
          dimension_id?: string
          dimension_name?: string | null
          entity_id?: string
          slot_no?: number
          status?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_dim_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_dim_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
      finance_dimension_detail: {
        Row: {
          company_id: string
          dimension_id: string
          dimension_value: string | null
          entity_id: string
          line_no: number
        }
        Insert: {
          company_id: string
          dimension_id: string
          dimension_value?: string | null
          entity_id: string
          line_no: number
        }
        Update: {
          company_id?: string
          dimension_id?: string
          dimension_value?: string | null
          entity_id?: string
          line_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_dimd_dim"
            columns: ["company_id", "entity_id", "dimension_id"]
            isOneToOne: false
            referencedRelation: "finance_dimension"
            referencedColumns: ["company_id", "entity_id", "dimension_id"]
          },
        ]
      }
      finance_gl: {
        Row: {
          bank_id: boolean
          client_id: boolean
          company_id: string
          contra_gl: string | null
          dimension1: boolean
          dimension2: boolean
          dimension3: boolean
          dimension4: boolean
          dimension5: boolean
          due_date: boolean
          employee_id: boolean
          entity_id: string
          gl_category1: string | null
          gl_category2: string | null
          gl_detail: string | null
          gl_id: string
          gl_name: string | null
          gl_type: string | null
          pod_id: boolean
          status: boolean
          team_id: boolean
          vat_gl: string | null
          vendor_id: boolean
        }
        Insert: {
          bank_id?: boolean
          client_id?: boolean
          company_id: string
          contra_gl?: string | null
          dimension1?: boolean
          dimension2?: boolean
          dimension3?: boolean
          dimension4?: boolean
          dimension5?: boolean
          due_date?: boolean
          employee_id?: boolean
          entity_id: string
          gl_category1?: string | null
          gl_category2?: string | null
          gl_detail?: string | null
          gl_id: string
          gl_name?: string | null
          gl_type?: string | null
          pod_id?: boolean
          status?: boolean
          team_id?: boolean
          vat_gl?: string | null
          vendor_id?: boolean
        }
        Update: {
          bank_id?: boolean
          client_id?: boolean
          company_id?: string
          contra_gl?: string | null
          dimension1?: boolean
          dimension2?: boolean
          dimension3?: boolean
          dimension4?: boolean
          dimension5?: boolean
          due_date?: boolean
          employee_id?: boolean
          entity_id?: string
          gl_category1?: string | null
          gl_category2?: string | null
          gl_detail?: string | null
          gl_id?: string
          gl_name?: string | null
          gl_type?: string | null
          pod_id?: boolean
          status?: boolean
          team_id?: boolean
          vat_gl?: string | null
          vendor_id?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_gl_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_gl_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
      finance_gl_seed: {
        Row: {
          bank_id: boolean
          client_id: boolean
          contra_gl: string | null
          dimension1: boolean
          dimension2: boolean
          dimension3: boolean
          dimension4: boolean
          dimension5: boolean
          due_date: boolean
          employee_id: boolean
          gl_category1: string | null
          gl_category2: string | null
          gl_detail: string | null
          gl_id: string
          gl_name: string | null
          gl_type: string | null
          pod_id: boolean
          status: boolean
          team_id: boolean
          vat_gl: string | null
          vendor_id: boolean
        }
        Insert: {
          bank_id?: boolean
          client_id?: boolean
          contra_gl?: string | null
          dimension1?: boolean
          dimension2?: boolean
          dimension3?: boolean
          dimension4?: boolean
          dimension5?: boolean
          due_date?: boolean
          employee_id?: boolean
          gl_category1?: string | null
          gl_category2?: string | null
          gl_detail?: string | null
          gl_id: string
          gl_name?: string | null
          gl_type?: string | null
          pod_id?: boolean
          status?: boolean
          team_id?: boolean
          vat_gl?: string | null
          vendor_id?: boolean
        }
        Update: {
          bank_id?: boolean
          client_id?: boolean
          contra_gl?: string | null
          dimension1?: boolean
          dimension2?: boolean
          dimension3?: boolean
          dimension4?: boolean
          dimension5?: boolean
          due_date?: boolean
          employee_id?: boolean
          gl_category1?: string | null
          gl_category2?: string | null
          gl_detail?: string | null
          gl_id?: string
          gl_name?: string | null
          gl_type?: string | null
          pod_id?: boolean
          status?: boolean
          team_id?: boolean
          vat_gl?: string | null
          vendor_id?: boolean
        }
        Relationships: []
      }
      finance_ledger_detail: {
        Row: {
          amount: number | null
          bank_id: string | null
          client_id: string | null
          company_id: string
          dimension1: string | null
          dimension2: string | null
          dimension3: string | null
          dimension4: string | null
          dimension5: string | null
          drcr: string | null
          due_date: string | null
          employee_id: string | null
          entity_id: string
          gl_id: string
          ledger_date: string
          ledger_no: number
          line_on: number
          pod_id: string | null
          team_id: string | null
          vendor_id: string | null
        }
        Insert: {
          amount?: number | null
          bank_id?: string | null
          client_id?: string | null
          company_id: string
          dimension1?: string | null
          dimension2?: string | null
          dimension3?: string | null
          dimension4?: string | null
          dimension5?: string | null
          drcr?: string | null
          due_date?: string | null
          employee_id?: string | null
          entity_id: string
          gl_id: string
          ledger_date: string
          ledger_no: number
          line_on: number
          pod_id?: string | null
          team_id?: string | null
          vendor_id?: string | null
        }
        Update: {
          amount?: number | null
          bank_id?: string | null
          client_id?: string | null
          company_id?: string
          dimension1?: string | null
          dimension2?: string | null
          dimension3?: string | null
          dimension4?: string | null
          dimension5?: string | null
          drcr?: string | null
          due_date?: string | null
          employee_id?: string | null
          entity_id?: string
          gl_id?: string
          ledger_date?: string
          ledger_no?: number
          line_on?: number
          pod_id?: string | null
          team_id?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_ld_bank"
            columns: ["company_id", "entity_id", "bank_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_account"
            referencedColumns: ["company_id", "entity_id", "bank_id"]
          },
          {
            foreignKeyName: "fk_ld_bank"
            columns: ["company_id", "entity_id", "bank_id"]
            isOneToOne: false
            referencedRelation: "v_finance_bank_account"
            referencedColumns: ["company_id", "entity_id", "bank_id"]
          },
          {
            foreignKeyName: "fk_ld_gl"
            columns: ["company_id", "entity_id", "gl_id"]
            isOneToOne: false
            referencedRelation: "finance_gl"
            referencedColumns: ["company_id", "entity_id", "gl_id"]
          },
          {
            foreignKeyName: "fk_ld_gl"
            columns: ["company_id", "entity_id", "gl_id"]
            isOneToOne: false
            referencedRelation: "v_finance_gl"
            referencedColumns: ["company_id", "entity_id", "gl_id"]
          },
          {
            foreignKeyName: "fk_ld_gl"
            columns: ["company_id", "entity_id", "gl_id"]
            isOneToOne: false
            referencedRelation: "v_finance_gl_full"
            referencedColumns: ["company_id", "entity_id", "gl_id"]
          },
          {
            foreignKeyName: "fk_ld_head"
            columns: ["company_id", "entity_id", "ledger_date", "ledger_no"]
            isOneToOne: false
            referencedRelation: "finance_ledger_head"
            referencedColumns: [
              "company_id",
              "entity_id",
              "ledger_date",
              "ledger_no",
            ]
          },
          {
            foreignKeyName: "fk_ld_head"
            columns: ["company_id", "entity_id", "ledger_date", "ledger_no"]
            isOneToOne: false
            referencedRelation: "v_finance_ledger"
            referencedColumns: [
              "company_id",
              "entity_id",
              "ledger_date",
              "ledger_no",
            ]
          },
        ]
      }
      finance_ledger_head: {
        Row: {
          approval_status: boolean
          approved_date: string | null
          approver_id: string | null
          company_id: string
          employee_id: string | null
          entity_id: string
          insert_date: string | null
          ledger_date: string
          ledger_name: string | null
          ledger_no: number
          ledger_type: string | null
          update_date: string | null
        }
        Insert: {
          approval_status?: boolean
          approved_date?: string | null
          approver_id?: string | null
          company_id: string
          employee_id?: string | null
          entity_id: string
          insert_date?: string | null
          ledger_date: string
          ledger_name?: string | null
          ledger_no: number
          ledger_type?: string | null
          update_date?: string | null
        }
        Update: {
          approval_status?: boolean
          approved_date?: string | null
          approver_id?: string | null
          company_id?: string
          employee_id?: string | null
          entity_id?: string
          insert_date?: string | null
          ledger_date?: string
          ledger_name?: string | null
          ledger_no?: number
          ledger_type?: string | null
          update_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_lh_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_lh_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
      finance_open_balance: {
        Row: {
          amount: number
          bank_id: string | null
          bank_key: string
          client_id: string | null
          client_key: string
          closed: boolean
          company_id: string
          company_year_id: string
          drcr: string
          entity_id: string
          gl_id: string
          source: string
          vendor_id: string | null
          vendor_key: string
        }
        Insert: {
          amount?: number
          bank_id?: string | null
          bank_key?: string
          client_id?: string | null
          client_key?: string
          closed?: boolean
          company_id: string
          company_year_id: string
          drcr: string
          entity_id: string
          gl_id: string
          source?: string
          vendor_id?: string | null
          vendor_key?: string
        }
        Update: {
          amount?: number
          bank_id?: string | null
          bank_key?: string
          client_id?: string | null
          client_key?: string
          closed?: boolean
          company_id?: string
          company_year_id?: string
          drcr?: string
          entity_id?: string
          gl_id?: string
          source?: string
          vendor_id?: string | null
          vendor_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_ob_bank"
            columns: ["company_id", "entity_id", "bank_id"]
            isOneToOne: false
            referencedRelation: "finance_bank_account"
            referencedColumns: ["company_id", "entity_id", "bank_id"]
          },
          {
            foreignKeyName: "fk_ob_bank"
            columns: ["company_id", "entity_id", "bank_id"]
            isOneToOne: false
            referencedRelation: "v_finance_bank_account"
            referencedColumns: ["company_id", "entity_id", "bank_id"]
          },
          {
            foreignKeyName: "fk_ob_gl"
            columns: ["company_id", "entity_id", "gl_id"]
            isOneToOne: false
            referencedRelation: "finance_gl"
            referencedColumns: ["company_id", "entity_id", "gl_id"]
          },
          {
            foreignKeyName: "fk_ob_gl"
            columns: ["company_id", "entity_id", "gl_id"]
            isOneToOne: false
            referencedRelation: "v_finance_gl"
            referencedColumns: ["company_id", "entity_id", "gl_id"]
          },
          {
            foreignKeyName: "fk_ob_gl"
            columns: ["company_id", "entity_id", "gl_id"]
            isOneToOne: false
            referencedRelation: "v_finance_gl_full"
            referencedColumns: ["company_id", "entity_id", "gl_id"]
          },
          {
            foreignKeyName: "fk_ob_year"
            columns: ["company_id", "entity_id", "company_year_id"]
            isOneToOne: false
            referencedRelation: "system_year"
            referencedColumns: ["company_id", "entity_id", "company_year_id"]
          },
          {
            foreignKeyName: "fk_ob_year"
            columns: ["company_id", "entity_id", "company_year_id"]
            isOneToOne: false
            referencedRelation: "v_finance_closing"
            referencedColumns: ["company_id", "entity_id", "company_year_id"]
          },
        ]
      }
      partner_client: {
        Row: {
          bank_account: string | null
          bank_branch: string | null
          bank_code: string | null
          bank_holder: string | null
          biz_category: string | null
          biz_industry: string | null
          client_address: string | null
          client_id: string
          client_name: string
          collecting_type: string | null
          company_id: string
          default_billing_currency: string | null
          entity_id: string
          fax_number: string | null
          industry: string | null
          logo_url: string | null
          nick_name: string | null
          notes: string | null
          phone_number: string | null
          reg_num: string | null
          rep_name: string | null
          status: boolean
          vat_id: string | null
          website: string | null
        }
        Insert: {
          bank_account?: string | null
          bank_branch?: string | null
          bank_code?: string | null
          bank_holder?: string | null
          biz_category?: string | null
          biz_industry?: string | null
          client_address?: string | null
          client_id: string
          client_name: string
          collecting_type?: string | null
          company_id: string
          default_billing_currency?: string | null
          entity_id: string
          fax_number?: string | null
          industry?: string | null
          logo_url?: string | null
          nick_name?: string | null
          notes?: string | null
          phone_number?: string | null
          reg_num?: string | null
          rep_name?: string | null
          status?: boolean
          vat_id?: string | null
          website?: string | null
        }
        Update: {
          bank_account?: string | null
          bank_branch?: string | null
          bank_code?: string | null
          bank_holder?: string | null
          biz_category?: string | null
          biz_industry?: string | null
          client_address?: string | null
          client_id?: string
          client_name?: string
          collecting_type?: string | null
          company_id?: string
          default_billing_currency?: string | null
          entity_id?: string
          fax_number?: string | null
          industry?: string | null
          logo_url?: string | null
          nick_name?: string | null
          notes?: string | null
          phone_number?: string | null
          reg_num?: string | null
          rep_name?: string | null
          status?: boolean
          vat_id?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_client_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_client_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_client_term"
            columns: ["company_id", "entity_id", "collecting_type"]
            isOneToOne: false
            referencedRelation: "partner_term"
            referencedColumns: ["company_id", "entity_id", "term_id"]
          },
        ]
      }
      partner_term: {
        Row: {
          base_rule: string
          company_id: string
          entity_id: string
          fixed_day: number | null
          offset_days: number
          status: boolean
          term_condition: string
          term_id: string
        }
        Insert: {
          base_rule: string
          company_id: string
          entity_id: string
          fixed_day?: number | null
          offset_days?: number
          status?: boolean
          term_condition?: string
          term_id: string
        }
        Update: {
          base_rule?: string
          company_id?: string
          entity_id?: string
          fixed_day?: number | null
          offset_days?: number
          status?: boolean
          term_condition?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_term_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_term_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
      partner_vendor: {
        Row: {
          bank_account: string | null
          bank_branch: string | null
          bank_code: string | null
          bank_holder: string | null
          biz_category: string | null
          biz_industry: string | null
          company_id: string
          default_billing_currency: string | null
          entity_id: string
          fax_number: string | null
          industry: string | null
          logo_url: string | null
          nick_name: string | null
          notes: string | null
          payment_type: string | null
          phone_number: string | null
          reg_num: string | null
          rep_name: string | null
          status: boolean
          vat_id: string | null
          vendor_address: string | null
          vendor_id: string
          vendor_name: string
          website: string | null
        }
        Insert: {
          bank_account?: string | null
          bank_branch?: string | null
          bank_code?: string | null
          bank_holder?: string | null
          biz_category?: string | null
          biz_industry?: string | null
          company_id: string
          default_billing_currency?: string | null
          entity_id: string
          fax_number?: string | null
          industry?: string | null
          logo_url?: string | null
          nick_name?: string | null
          notes?: string | null
          payment_type?: string | null
          phone_number?: string | null
          reg_num?: string | null
          rep_name?: string | null
          status?: boolean
          vat_id?: string | null
          vendor_address?: string | null
          vendor_id: string
          vendor_name: string
          website?: string | null
        }
        Update: {
          bank_account?: string | null
          bank_branch?: string | null
          bank_code?: string | null
          bank_holder?: string | null
          biz_category?: string | null
          biz_industry?: string | null
          company_id?: string
          default_billing_currency?: string | null
          entity_id?: string
          fax_number?: string | null
          industry?: string | null
          logo_url?: string | null
          nick_name?: string | null
          notes?: string | null
          payment_type?: string | null
          phone_number?: string | null
          reg_num?: string | null
          rep_name?: string | null
          status?: boolean
          vat_id?: string | null
          vendor_address?: string | null
          vendor_id?: string
          vendor_name?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_vendor_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_vendor_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_vendor_term"
            columns: ["company_id", "entity_id", "payment_type"]
            isOneToOne: false
            referencedRelation: "partner_term"
            referencedColumns: ["company_id", "entity_id", "term_id"]
          },
        ]
      }
      sales_contract: {
        Row: {
          client_id: string
          closed_date: string | null
          company_id: string
          contract_amount: number | null
          contract_id: string
          contract_type: string
          end_date: string
          entity_id: string
          ledger_date: string | null
          ledger_no: number | null
          pipeline_id: string | null
          start_date: string
          status: string
        }
        Insert: {
          client_id: string
          closed_date?: string | null
          company_id: string
          contract_amount?: number | null
          contract_id: string
          contract_type?: string
          end_date: string
          entity_id: string
          ledger_date?: string | null
          ledger_no?: number | null
          pipeline_id?: string | null
          start_date: string
          status?: string
        }
        Update: {
          client_id?: string
          closed_date?: string | null
          company_id?: string
          contract_amount?: number | null
          contract_id?: string
          contract_type?: string
          end_date?: string
          entity_id?: string
          ledger_date?: string | null
          ledger_no?: number | null
          pipeline_id?: string | null
          start_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_ct_client"
            columns: ["company_id", "entity_id", "client_id"]
            isOneToOne: false
            referencedRelation: "partner_client"
            referencedColumns: ["company_id", "entity_id", "client_id"]
          },
          {
            foreignKeyName: "fk_ct_client"
            columns: ["company_id", "entity_id", "client_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client"
            referencedColumns: ["company_id", "entity_id", "client_id"]
          },
        ]
      }
      sales_pipeline: {
        Row: {
          adjusted_date: string | null
          client_name: string | null
          closed_date: string | null
          company_id: string
          contract_id: string | null
          created_date: string | null
          employee_id: string | null
          entity_id: string
          note: string | null
          pipeline_id: string
          pipeline_type: string | null
          stage: string | null
        }
        Insert: {
          adjusted_date?: string | null
          client_name?: string | null
          closed_date?: string | null
          company_id: string
          contract_id?: string | null
          created_date?: string | null
          employee_id?: string | null
          entity_id: string
          note?: string | null
          pipeline_id: string
          pipeline_type?: string | null
          stage?: string | null
        }
        Update: {
          adjusted_date?: string | null
          client_name?: string | null
          closed_date?: string | null
          company_id?: string
          contract_id?: string | null
          created_date?: string | null
          employee_id?: string | null
          entity_id?: string
          note?: string | null
          pipeline_id?: string
          pipeline_type?: string | null
          stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_pipe_emp"
            columns: ["company_id", "entity_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "system_employee"
            referencedColumns: ["company_id", "entity_id", "employee_id"]
          },
          {
            foreignKeyName: "fk_pipe_emp"
            columns: ["company_id", "entity_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "v_system_employee"
            referencedColumns: ["company_id", "entity_id", "employee_id"]
          },
          {
            foreignKeyName: "fk_pipe_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_pipe_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
      sales_pipeline_detail: {
        Row: {
          activity_id: string
          activity_type: string
          attached: string | null
          company_id: string
          content: string | null
          created_date: string | null
          entity_id: string
          incharge: string | null
          pipeline_id: string
        }
        Insert: {
          activity_id: string
          activity_type?: string
          attached?: string | null
          company_id: string
          content?: string | null
          created_date?: string | null
          entity_id: string
          incharge?: string | null
          pipeline_id: string
        }
        Update: {
          activity_id?: string
          activity_type?: string
          attached?: string | null
          company_id?: string
          content?: string | null
          created_date?: string | null
          entity_id?: string
          incharge?: string | null
          pipeline_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_act_pipe"
            columns: ["company_id", "entity_id", "pipeline_id"]
            isOneToOne: false
            referencedRelation: "sales_pipeline"
            referencedColumns: ["company_id", "entity_id", "pipeline_id"]
          },
          {
            foreignKeyName: "fk_act_pipe"
            columns: ["company_id", "entity_id", "pipeline_id"]
            isOneToOne: false
            referencedRelation: "v_sales_pipeline"
            referencedColumns: ["company_id", "entity_id", "pipeline_id"]
          },
        ]
      }
      system_company: {
        Row: {
          company_id: string
          company_name: string
          company_name_ko: string
          description: string | null
          note: string | null
          status: boolean
        }
        Insert: {
          company_id: string
          company_name: string
          company_name_ko: string
          description?: string | null
          note?: string | null
          status?: boolean
        }
        Update: {
          company_id?: string
          company_name?: string
          company_name_ko?: string
          description?: string | null
          note?: string | null
          status?: boolean
        }
        Relationships: []
      }
      system_employee: {
        Row: {
          auth_user_id: string | null
          ax_role: string
          birthday: string | null
          company_id: string
          departure_date: string | null
          email: string
          employee_id: string
          employee_name: string
          employment_type: string | null
          english_name: string | null
          entity_id: string
          last_manual_edit_at: string | null
          phone: string | null
          profile_image_url: string | null
          slack_handle: string | null
          slack_user_id: string | null
          social_buddy: string | null
          start_date: string | null
          status: string | null
          team_id: string
          timezone: string | null
          title: string | null
          title_abbr: string | null
          user_id: string | null
          user_yn: boolean
        }
        Insert: {
          auth_user_id?: string | null
          ax_role?: string
          birthday?: string | null
          company_id: string
          departure_date?: string | null
          email: string
          employee_id: string
          employee_name: string
          employment_type?: string | null
          english_name?: string | null
          entity_id: string
          last_manual_edit_at?: string | null
          phone?: string | null
          profile_image_url?: string | null
          slack_handle?: string | null
          slack_user_id?: string | null
          social_buddy?: string | null
          start_date?: string | null
          status?: string | null
          team_id: string
          timezone?: string | null
          title?: string | null
          title_abbr?: string | null
          user_id?: string | null
          user_yn?: boolean
        }
        Update: {
          auth_user_id?: string | null
          ax_role?: string
          birthday?: string | null
          company_id?: string
          departure_date?: string | null
          email?: string
          employee_id?: string
          employee_name?: string
          employment_type?: string | null
          english_name?: string | null
          entity_id?: string
          last_manual_edit_at?: string | null
          phone?: string | null
          profile_image_url?: string | null
          slack_handle?: string | null
          slack_user_id?: string | null
          social_buddy?: string | null
          start_date?: string | null
          status?: string | null
          team_id?: string
          timezone?: string | null
          title?: string | null
          title_abbr?: string | null
          user_id?: string | null
          user_yn?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_emp_team"
            columns: ["company_id", "entity_id", "team_id"]
            isOneToOne: false
            referencedRelation: "system_team"
            referencedColumns: ["company_id", "entity_id", "team_id"]
          },
        ]
      }
      system_entity: {
        Row: {
          address: string | null
          biz_category: string | null
          biz_industry: string | null
          biz_num: string | null
          company_id: string
          description: string | null
          entity_id: string
          entity_name: string
          entity_name_ko: string
          estabilish_date: string | null
          fax_number: string | null
          note: string | null
          phone_number: string | null
          reg_num: string | null
          rep_name: string | null
          status: boolean
        }
        Insert: {
          address?: string | null
          biz_category?: string | null
          biz_industry?: string | null
          biz_num?: string | null
          company_id: string
          description?: string | null
          entity_id: string
          entity_name: string
          entity_name_ko: string
          estabilish_date?: string | null
          fax_number?: string | null
          note?: string | null
          phone_number?: string | null
          reg_num?: string | null
          rep_name?: string | null
          status?: boolean
        }
        Update: {
          address?: string | null
          biz_category?: string | null
          biz_industry?: string | null
          biz_num?: string | null
          company_id?: string
          description?: string | null
          entity_id?: string
          entity_name?: string
          entity_name_ko?: string
          estabilish_date?: string | null
          fax_number?: string | null
          note?: string | null
          phone_number?: string | null
          reg_num?: string | null
          rep_name?: string | null
          status?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_entity_company"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "system_company"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "fk_entity_company"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_system_company"
            referencedColumns: ["company_id"]
          },
        ]
      }
      system_pod: {
        Row: {
          company_id: string
          entity_id: string
          pod_id: string
          pod_name: string
          status: boolean
        }
        Insert: {
          company_id: string
          entity_id: string
          pod_id: string
          pod_name: string
          status?: boolean
        }
        Update: {
          company_id?: string
          entity_id?: string
          pod_id?: string
          pod_name?: string
          status?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_pod_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_pod_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
      system_team: {
        Row: {
          company_id: string
          entity_id: string
          leader_user_id: string
          note: string | null
          owner: string
          pod_id: string | null
          status: boolean
          team_id: string
          team_name: string | null
          team_name_ko: string | null
        }
        Insert: {
          company_id: string
          entity_id: string
          leader_user_id: string
          note?: string | null
          owner: string
          pod_id?: string | null
          status?: boolean
          team_id: string
          team_name?: string | null
          team_name_ko?: string | null
        }
        Update: {
          company_id?: string
          entity_id?: string
          leader_user_id?: string
          note?: string | null
          owner?: string
          pod_id?: string | null
          status?: boolean
          team_id?: string
          team_name?: string | null
          team_name_ko?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_team_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_team_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_team_pod"
            columns: ["company_id", "entity_id", "pod_id"]
            isOneToOne: false
            referencedRelation: "system_pod"
            referencedColumns: ["company_id", "entity_id", "pod_id"]
          },
        ]
      }
      system_year: {
        Row: {
          actual_year: number
          company_id: string
          company_year: number
          company_year_id: string
          entity_id: string
        }
        Insert: {
          actual_year: number
          company_id: string
          company_year: number
          company_year_id: string
          entity_id: string
        }
        Update: {
          actual_year?: number
          company_id?: string
          company_year?: number
          company_year_id?: string
          entity_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_year_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_year_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
    }
    Views: {
      v_finance_bank_account: {
        Row: {
          bank_account: string | null
          bank_id: string | null
          bank_name: string | null
          card_number_masked: string | null
          company_id: string | null
          entity_id: string | null
          is_active: boolean | null
          is_card: boolean | null
          status: boolean | null
        }
        Insert: {
          bank_account?: string | null
          bank_id?: string | null
          bank_name?: string | null
          card_number_masked?: never
          company_id?: string | null
          entity_id?: string | null
          is_active?: never
          is_card?: boolean | null
          status?: boolean | null
        }
        Update: {
          bank_account?: string | null
          bank_id?: string | null
          bank_name?: string | null
          card_number_masked?: never
          company_id?: string | null
          entity_id?: string | null
          is_active?: never
          is_card?: boolean | null
          status?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_bank_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_bank_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
      v_finance_closing: {
        Row: {
          actual_year: number | null
          closing: boolean | null
          closing_date: string | null
          company_id: string | null
          company_year: number | null
          company_year_id: string | null
          entity_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_year_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_year_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
      v_finance_gl: {
        Row: {
          bank_id: boolean | null
          client_id: boolean | null
          company_id: string | null
          contra_gl: string | null
          dimension1: boolean | null
          dimension2: boolean | null
          dimension3: boolean | null
          dimension4: boolean | null
          dimension5: boolean | null
          due_date: boolean | null
          employee_id: boolean | null
          entity_id: string | null
          gl_category1: string | null
          gl_category2: string | null
          gl_detail: string | null
          gl_id: string | null
          gl_name: string | null
          gl_type: string | null
          is_active: boolean | null
          pod_id: boolean | null
          status: boolean | null
          team_id: boolean | null
          vat_gl: string | null
          vendor_id: boolean | null
        }
        Insert: {
          bank_id?: boolean | null
          client_id?: boolean | null
          company_id?: string | null
          contra_gl?: string | null
          dimension1?: boolean | null
          dimension2?: boolean | null
          dimension3?: boolean | null
          dimension4?: boolean | null
          dimension5?: boolean | null
          due_date?: boolean | null
          employee_id?: boolean | null
          entity_id?: string | null
          gl_category1?: string | null
          gl_category2?: string | null
          gl_detail?: string | null
          gl_id?: string | null
          gl_name?: string | null
          gl_type?: string | null
          is_active?: boolean | null
          pod_id?: boolean | null
          status?: boolean | null
          team_id?: boolean | null
          vat_gl?: string | null
          vendor_id?: boolean | null
        }
        Update: {
          bank_id?: boolean | null
          client_id?: boolean | null
          company_id?: string | null
          contra_gl?: string | null
          dimension1?: boolean | null
          dimension2?: boolean | null
          dimension3?: boolean | null
          dimension4?: boolean | null
          dimension5?: boolean | null
          due_date?: boolean | null
          employee_id?: boolean | null
          entity_id?: string | null
          gl_category1?: string | null
          gl_category2?: string | null
          gl_detail?: string | null
          gl_id?: string | null
          gl_name?: string | null
          gl_type?: string | null
          is_active?: boolean | null
          pod_id?: boolean | null
          status?: boolean | null
          team_id?: boolean | null
          vat_gl?: string | null
          vendor_id?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_gl_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_gl_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
      v_finance_gl_full: {
        Row: {
          bank_id: boolean | null
          client_id: boolean | null
          company_id: string | null
          contra_gl: string | null
          dimension1: boolean | null
          dimension1_name: string | null
          dimension2: boolean | null
          dimension2_name: string | null
          dimension3: boolean | null
          dimension3_name: string | null
          dimension4: boolean | null
          dimension4_name: string | null
          dimension5: boolean | null
          dimension5_name: string | null
          due_date: boolean | null
          employee_id: boolean | null
          entity_id: string | null
          gl_category1: string | null
          gl_category2: string | null
          gl_detail: string | null
          gl_id: string | null
          gl_name: string | null
          gl_type: string | null
          is_active: boolean | null
          pod_id: boolean | null
          status: boolean | null
          team_id: boolean | null
          vat_gl: string | null
          vendor_id: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_gl_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_gl_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
      v_finance_ledger: {
        Row: {
          approval_status: boolean | null
          approved_date: string | null
          approver_id: string | null
          approver_name: string | null
          company_id: string | null
          credit_total: number | null
          debit_total: number | null
          employee_id: string | null
          employee_name: string | null
          entity_id: string | null
          insert_date: string | null
          ledger_date: string | null
          ledger_name: string | null
          ledger_no: number | null
          ledger_type: string | null
          line_count: number | null
          update_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_lh_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_lh_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
      v_partner_client: {
        Row: {
          bank_account: string | null
          bank_branch: string | null
          bank_code: string | null
          bank_holder: string | null
          biz_category: string | null
          biz_industry: string | null
          client_address: string | null
          client_id: string | null
          client_name: string | null
          collecting_term_condition: string | null
          collecting_type: string | null
          company_id: string | null
          entity_id: string | null
          fax_number: string | null
          industry: string | null
          is_active: boolean | null
          logo_url: string | null
          nick_name: string | null
          notes: string | null
          phone_number: string | null
          reg_num: string | null
          rep_name: string | null
          status: boolean | null
          vat_id: string | null
          website: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_client_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_client_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_client_term"
            columns: ["company_id", "entity_id", "collecting_type"]
            isOneToOne: false
            referencedRelation: "partner_term"
            referencedColumns: ["company_id", "entity_id", "term_id"]
          },
        ]
      }
      v_partner_vendor: {
        Row: {
          bank_account: string | null
          bank_branch: string | null
          bank_code: string | null
          bank_holder: string | null
          biz_category: string | null
          biz_industry: string | null
          company_id: string | null
          entity_id: string | null
          fax_number: string | null
          industry: string | null
          is_active: boolean | null
          logo_url: string | null
          nick_name: string | null
          notes: string | null
          payment_term_condition: string | null
          payment_type: string | null
          phone_number: string | null
          reg_num: string | null
          rep_name: string | null
          status: boolean | null
          vat_id: string | null
          vendor_address: string | null
          vendor_id: string | null
          vendor_name: string | null
          website: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_vendor_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_vendor_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_vendor_term"
            columns: ["company_id", "entity_id", "payment_type"]
            isOneToOne: false
            referencedRelation: "partner_term"
            referencedColumns: ["company_id", "entity_id", "term_id"]
          },
        ]
      }
      v_sales_contract: {
        Row: {
          client_id: string | null
          client_name: string | null
          closed_date: string | null
          company_id: string | null
          contract_amount: number | null
          contract_id: string | null
          contract_type: string | null
          end_date: string | null
          entity_id: string | null
          has_ledger: boolean | null
          ledger_date: string | null
          ledger_no: number | null
          pipeline_id: string | null
          start_date: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_ct_client"
            columns: ["company_id", "entity_id", "client_id"]
            isOneToOne: false
            referencedRelation: "partner_client"
            referencedColumns: ["company_id", "entity_id", "client_id"]
          },
          {
            foreignKeyName: "fk_ct_client"
            columns: ["company_id", "entity_id", "client_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client"
            referencedColumns: ["company_id", "entity_id", "client_id"]
          },
        ]
      }
      v_sales_pipeline: {
        Row: {
          adjusted_date: string | null
          client_name: string | null
          closed_date: string | null
          company_id: string | null
          contract_id: string | null
          created_date: string | null
          employee_id: string | null
          employee_name: string | null
          entity_id: string | null
          is_closed: boolean | null
          note: string | null
          pipeline_id: string | null
          pipeline_type: string | null
          stage: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_pipe_emp"
            columns: ["company_id", "entity_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "system_employee"
            referencedColumns: ["company_id", "entity_id", "employee_id"]
          },
          {
            foreignKeyName: "fk_pipe_emp"
            columns: ["company_id", "entity_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "v_system_employee"
            referencedColumns: ["company_id", "entity_id", "employee_id"]
          },
          {
            foreignKeyName: "fk_pipe_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
          {
            foreignKeyName: "fk_pipe_entity"
            columns: ["company_id", "entity_id"]
            isOneToOne: false
            referencedRelation: "v_system_entity"
            referencedColumns: ["company_id", "entity_id"]
          },
        ]
      }
      v_system_company: {
        Row: {
          company_id: string | null
          company_name: string | null
          company_name_ko: string | null
          description: string | null
          is_active: boolean | null
          note: string | null
          status: boolean | null
        }
        Insert: {
          company_id?: string | null
          company_name?: string | null
          company_name_ko?: string | null
          description?: string | null
          is_active?: never
          note?: string | null
          status?: boolean | null
        }
        Update: {
          company_id?: string | null
          company_name?: string | null
          company_name_ko?: string | null
          description?: string | null
          is_active?: never
          note?: string | null
          status?: boolean | null
        }
        Relationships: []
      }
      v_system_employee: {
        Row: {
          ax_role: string | null
          birthday: string | null
          company_id: string | null
          departure_date: string | null
          email: string | null
          employee_id: string | null
          employee_name: string | null
          employment_type: string | null
          english_name: string | null
          entity_id: string | null
          has_account: boolean | null
          is_active: boolean | null
          last_login: string | null
          last_manual_edit_at: string | null
          phone: string | null
          profile_image_url: string | null
          slack_handle: string | null
          slack_user_id: string | null
          social_buddy: string | null
          start_date: string | null
          status: string | null
          team_id: string | null
          timezone: string | null
          title: string | null
          title_abbr: string | null
          user_id: string | null
          user_yn: boolean | null
        }
        Insert: {
          ax_role?: string | null
          birthday?: string | null
          company_id?: string | null
          departure_date?: string | null
          email?: string | null
          employee_id?: string | null
          employee_name?: string | null
          employment_type?: string | null
          english_name?: string | null
          entity_id?: string | null
          has_account?: never
          is_active?: never
          last_login?: never
          last_manual_edit_at?: string | null
          phone?: string | null
          profile_image_url?: string | null
          slack_handle?: string | null
          slack_user_id?: string | null
          social_buddy?: string | null
          start_date?: string | null
          status?: string | null
          team_id?: string | null
          timezone?: string | null
          title?: string | null
          title_abbr?: string | null
          user_id?: string | null
          user_yn?: boolean | null
        }
        Update: {
          ax_role?: string | null
          birthday?: string | null
          company_id?: string | null
          departure_date?: string | null
          email?: string | null
          employee_id?: string | null
          employee_name?: string | null
          employment_type?: string | null
          english_name?: string | null
          entity_id?: string | null
          has_account?: never
          is_active?: never
          last_login?: never
          last_manual_edit_at?: string | null
          phone?: string | null
          profile_image_url?: string | null
          slack_handle?: string | null
          slack_user_id?: string | null
          social_buddy?: string | null
          start_date?: string | null
          status?: string | null
          team_id?: string | null
          timezone?: string | null
          title?: string | null
          title_abbr?: string | null
          user_id?: string | null
          user_yn?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_emp_team"
            columns: ["company_id", "entity_id", "team_id"]
            isOneToOne: false
            referencedRelation: "system_team"
            referencedColumns: ["company_id", "entity_id", "team_id"]
          },
        ]
      }
      v_system_entity: {
        Row: {
          address: string | null
          biz_category: string | null
          biz_industry: string | null
          biz_num: string | null
          company_id: string | null
          description: string | null
          entity_id: string | null
          entity_name: string | null
          entity_name_ko: string | null
          establish_date: string | null
          fax_number: string | null
          is_active: boolean | null
          note: string | null
          phone_number: string | null
          reg_num: string | null
          rep_name: string | null
          status: boolean | null
        }
        Insert: {
          address?: string | null
          biz_category?: string | null
          biz_industry?: string | null
          biz_num?: string | null
          company_id?: string | null
          description?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_name_ko?: string | null
          establish_date?: string | null
          fax_number?: string | null
          is_active?: never
          note?: string | null
          phone_number?: string | null
          reg_num?: string | null
          rep_name?: string | null
          status?: boolean | null
        }
        Update: {
          address?: string | null
          biz_category?: string | null
          biz_industry?: string | null
          biz_num?: string | null
          company_id?: string | null
          description?: string | null
          entity_id?: string | null
          entity_name?: string | null
          entity_name_ko?: string | null
          establish_date?: string | null
          fax_number?: string | null
          is_active?: never
          note?: string | null
          phone_number?: string | null
          reg_num?: string | null
          rep_name?: string | null
          status?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_entity_company"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "system_company"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "fk_entity_company"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_system_company"
            referencedColumns: ["company_id"]
          },
        ]
      }
    }
    Functions: {
      auth_claims: { Args: never; Returns: Json }
      auth_company_id: { Args: never; Returns: string }
      auth_employee_id: { Args: never; Returns: string }
      auth_entity_id: { Args: never; Returns: string }
      auth_role_rank: { Args: never; Returns: number }
      auth_role_rank_live: { Args: never; Returns: number }
      ax_access_token_hook: { Args: { event: Json }; Returns: Json }
      ax_bank_card_masked: { Args: { p_bank_id: string }; Returns: string }
      ax_bootstrap_admin: {
        Args: { p_auth_user_id: string; p_email: string }
        Returns: Json
      }
      ax_escape_like: { Args: { p_text: string }; Returns: string }
      ax_finance_check_year_open: {
        Args: { p_target_date: string }
        Returns: undefined
      }
      ax_finance_closing_execute: {
        Args: { p_company_year_id: string }
        Returns: Json
      }
      ax_finance_closing_reopen: {
        Args: { p_company_year_id: string }
        Returns: Json
      }
      ax_finance_closing_status: {
        Args: { p_company_year_id: string }
        Returns: Json
      }
      ax_finance_dimension_delete: {
        Args: { p_dimension_id: string }
        Returns: undefined
      }
      ax_finance_dimension_save: { Args: { p_dim: Json }; Returns: Json }
      ax_finance_gl_generate_standard: { Args: never; Returns: Json }
      ax_finance_ledger_approve: {
        Args: { p_ledger_date: string; p_ledger_no: number }
        Returns: undefined
      }
      ax_finance_ledger_delete: {
        Args: { p_ledger_date: string; p_ledger_no: number }
        Returns: undefined
      }
      ax_finance_ledger_get: {
        Args: { p_ledger_date: string; p_ledger_no: number }
        Returns: Json
      }
      ax_finance_ledger_preview_account_change: {
        Args: { p_line: Json; p_new_gl_id: string }
        Returns: Json
      }
      ax_finance_ledger_save: {
        Args: { p_head: Json; p_lines: Json }
        Returns: Json
      }
      ax_finance_openbalance_close: {
        Args: { p_company_year_id: string }
        Returns: undefined
      }
      ax_finance_openbalance_list: {
        Args: {
          p_closed?: boolean
          p_company_year_id: string
          p_drcr?: string
          p_gl_keyword?: string
        }
        Returns: Json
      }
      ax_finance_openbalance_reopen: {
        Args: { p_company_year_id: string }
        Returns: undefined
      }
      ax_finance_openbalance_save: {
        Args: { p_company_year_id: string; p_rows: Json }
        Returns: Json
      }
      ax_flag: { Args: { p_key: string }; Returns: boolean }
      ax_is_year_closed: {
        Args: { p_company_id: string; p_date: string; p_entity_id: string }
        Returns: boolean
      }
      ax_last_sign_in: { Args: { p_auth_user_id: string }; Returns: string }
      ax_mask_card: { Args: { p_card: string }; Returns: string }
      ax_partner_term_calc_due: {
        Args: { p_base_date: string; p_term_id: string }
        Returns: string
      }
      ax_raise: {
        Args: { p_code: number; p_http?: number; p_msg: string }
        Returns: undefined
      }
      ax_require_role: {
        Args: { p_action: string; p_min_rank: number }
        Returns: undefined
      }
      ax_require_scope: { Args: never; Returns: undefined }
      ax_safe_int: { Args: { p_text: string }; Returns: number }
      ax_sales_contract_link_ledger: {
        Args: {
          p_contract_id: string
          p_contract_type: string
          p_ledger_date?: string
          p_ledger_no?: number
        }
        Returns: undefined
      }
      ax_sales_pipeline_link_contract: {
        Args: { p_contract_id?: string; p_pipeline_id: string }
        Returns: undefined
      }
      ax_system_employee_delete: {
        Args: { p_employee_id: string }
        Returns: undefined
      }
      ax_system_employee_set_role: {
        Args: { p_employee_id: string; p_role: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

