import { isValidDDMMYYYY } from './dateMask';
export interface ClientFormData {
  name: string;
  company: string;
  contact: string;
  phone: string;
  email: string;
  address?: string;
  city: string;
  service?: string;
  services?: string;
  billing: 'Monthly Retainer' | 'One-Time' | 'Fixed Price' | 'Per Unit' | 'Milestone' | 'Hourly';
  pricing?: number;
  totalValue: number;
  paid: number;
  pending: number;
  status: 'Active' | 'Inactive' | 'Archived';
  gstin?: string;
  joinDate?: string;
  notes?: string;
}

export interface ClientValidationErrors {
  name?: string;
  company?: string;
  contact?: string;
  phone?: string;
  email?: string;
  city?: string;
  totalValue?: string;
  gstin?: string;
  billing?: string;
}

export interface ProjectFormData {
  name: string;
  clientId: number | string;
  clientName: string;
  serviceName: string;
  manager: string;
  startDate: string;
  deadline: string;
  value: number;
  received: number;
  progress: number;
  status: string;
  notes?: string;
  requirements?: string;
}

export interface ProjectValidationErrors {
  name?: string;
  clientId?: string;
  serviceName?: string;
  manager?: string;
  startDate?: string;
  deadline?: string;
  value?: string;
}

export interface ServiceFormData {
  name: string;
  description: string;
  pricingType: 'Monthly Retainer' | 'One-Time' | 'Fixed Price' | 'Per Unit' | 'Milestone' | 'Hourly';
  defaultPrice: number;
  status: 'Active' | 'Inactive' | 'Archived';
}

export interface ServiceValidationErrors {
  name?: string;
  description?: string;
  pricingType?: string;
  defaultPrice?: string;
}

export function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
}

export function validatePhone(phone: string): boolean {
  const cleanPhone = phone.replace(/[\s\-\(\)\+]/g, '');
  return /^\d{10,15}$/.test(cleanPhone);
}

export function validateGSTIN(gstin?: string): boolean {
  if (!gstin || !gstin.trim()) return true;
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
  return gstinRegex.test(gstin.trim());
}

export function validateClientForm(data: Partial<ClientFormData>): ClientValidationErrors {
  const errors: ClientValidationErrors = {};

  // Company is optional; the client is named after the contact person
  if (!data.contact || !data.contact.trim()) {
    errors.contact = 'Client name is required.';
  } else if (data.contact.trim().length < 2) {
    errors.contact = 'Client name must be at least 2 characters.';
  }

  if (!data.phone || !data.phone.trim()) {
    errors.phone = 'Phone number is required.';
  } else if (!validatePhone(data.phone)) {
    errors.phone = 'Enter a valid 10-digit phone number.';
  }

  if (!data.email || !data.email.trim()) {
    errors.email = 'Email address is required.';
  } else if (!validateEmail(data.email)) {
    errors.email = 'Enter a valid email address (e.g. name@domain.com).';
  }

  if (!data.city || !data.city.trim()) {
    errors.city = 'City is required.';
  }

  if (data.totalValue !== undefined && data.totalValue !== null && (isNaN(Number(data.totalValue)) || Number(data.totalValue) < 0)) {
    errors.totalValue = 'Total value must be 0 or a positive number.';
  }

  if (data.gstin && data.gstin.trim() && !validateGSTIN(data.gstin)) {
    errors.gstin = 'Invalid GSTIN format (e.g. 33AABCG1234F1ZL).';
  }

  return errors;
}

export function validateProjectForm(data: Partial<ProjectFormData>): ProjectValidationErrors {
  const errors: ProjectValidationErrors = {};

  if (!data.name || !data.name.trim()) {
    errors.name = 'Project name is required.';
  } else if (data.name.trim().length < 3) {
    errors.name = 'Project name must be at least 3 characters.';
  }

  if (!data.clientId) {
    errors.clientId = 'Please select a client.';
  }

  if (!data.serviceName || !data.serviceName.trim()) {
    errors.serviceName = 'Please select or enter a service.';
  }

  if (!data.manager || !data.manager.trim()) {
    errors.manager = 'Please assign a project manager.';
  }

  if (data.value === undefined || data.value === null || isNaN(Number(data.value)) || Number(data.value) <= 0) {
    errors.value = 'Project value must be greater than 0.';
  }

  if (data.startDate && data.startDate.trim() && !isValidDDMMYYYY(data.startDate.trim())) {
    errors.startDate = 'Enter the start date as DD/MM/YYYY.';
  }

  return errors;
}

export function validateServiceForm(data: Partial<ServiceFormData>): ServiceValidationErrors {
  const errors: ServiceValidationErrors = {};

  if (!data.name || !data.name.trim()) {
    errors.name = 'Service name is required.';
  } else if (data.name.trim().length < 2) {
    errors.name = 'Service name must be at least 2 characters.';
  }

  if (!data.description || !data.description.trim()) {
    errors.description = 'Description is required.';
  }

  if (!data.pricingType) {
    errors.pricingType = 'Please select a pricing type.';
  }

  if (data.defaultPrice === undefined || data.defaultPrice === null || isNaN(Number(data.defaultPrice)) || Number(data.defaultPrice) < 0) {
    errors.defaultPrice = 'Default price must be 0 or greater.';
  }

  return errors;
}

export interface DeliverableFormData {
  client: string;
  type: string;
  description: string;
  qty: string | number;
  rate: string | number;
  date: string;
  employee: string;
}

export interface DeliverableValidationErrors {
  client?: string;
  type?: string;
  description?: string;
  qty?: string;
  rate?: string;
  date?: string;
  employee?: string;
}

export function validateDeliverableForm(data: Partial<DeliverableFormData>): DeliverableValidationErrors {
  const errors: DeliverableValidationErrors = {};

  if (!data.client || !data.client.trim()) {
    errors.client = 'Client is required.';
  }

  if (!data.type || !data.type.trim()) {
    errors.type = 'Deliverable type is required.';
  }

  if (!data.description || !data.description.trim()) {
    errors.description = 'Description is required.';
  }

  const qtyStr = String(data.qty ?? '').trim();
  if (!qtyStr) {
    errors.qty = 'Quantity is required.';
  } else {
    const qtyNum = Number(qtyStr);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      errors.qty = 'Quantity must be greater than 0.';
    }
  }

  const rateStr = String(data.rate ?? '').trim();
  if (!rateStr) {
    errors.rate = 'Unit rate is required.';
  } else {
    const rateNum = Number(rateStr);
    if (isNaN(rateNum) || rateNum <= 0) {
      errors.rate = 'Unit rate must be greater than 0.';
    }
  }

  if (!data.date || !data.date.trim()) {
    errors.date = 'Date is required.';
  }

  if (!data.employee || !data.employee.trim()) {
    errors.employee = 'Employee is required.';
  }

  return errors;
}

